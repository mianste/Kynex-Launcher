package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.keke.kynex.account.AccountStore;
import com.keke.kynex.account.CredentialVault;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import javax.net.ssl.HttpsURLConnection;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;

final class MicrosoftLogin {
    private static final String ID = "9e5f94bc-e8a4-4e73-b8be-63364c29d753";
    private static final String MICROSOFT = "https://login.microsoftonline.com/consumers/oauth2/v2.0/";
    private static final String GAME = "https://api.minecraftservices.com";
    private static final String PROFILE = GAME + "/minecraft/profile";
    private static final String SCOPE = "XboxLive.signin offline_access";
    private static final Set<String> HOSTS = Set.of("login.microsoftonline.com", "login.live.com", "user.auth.xboxlive.com",
        "xsts.auth.xboxlive.com", "api.minecraftservices.com");
    private final AccountStore accounts;
    private final CredentialVault vault;
    private final Network network;
    private final LongSupplier nanos;
    private final Map<String, Flow> flows = new ConcurrentHashMap<>();

    interface Network {
        Response request(String url, String body, String mime, String bearer) throws IOException;
    }

    record Response(int status, JsonObject body) {
        boolean ok() { return status >= 200 && status < 300; }
    }

    record Session(String token, String kind) {
        @Override public String toString() { return "Session[" + kind + "]"; }
    }

    private record Exchange(JsonObject profile, String token, long seconds) {}

    private static final class Flow {
        final String device;
        final String client;
        final long expiry;
        long next;
        int interval;
        boolean busy;
        boolean cancelled;

        Flow(String device, String client, long now, int expiry, int interval) {
            this.device = device;
            this.client = client;
            this.interval = interval;
            this.expiry = now + Duration.ofSeconds(expiry).toNanos();
            this.next = now + Duration.ofSeconds(interval).toNanos();
        }
    }

    MicrosoftLogin(AccountStore accounts, CredentialVault vault) {
        this(accounts, vault, MicrosoftLogin::https, System::nanoTime);
    }

    MicrosoftLogin(AccountStore accounts, CredentialVault vault, Network network, LongSupplier nanos) {
        this.accounts = accounts;
        this.vault = vault;
        this.network = (url, body, mime, bearer) ->
            NetworkFailure.retryDns(() -> network.request(url, body, mime, bearer));
        this.nanos = nanos;
    }

    JsonObject status() throws IOException {
        var result = new JsonObject();
        result.addProperty("configured", true);
        result.addProperty("embedded", true);
        result.addProperty("clientId", client());
        return result;
    }

    JsonObject start() throws IOException {
        String client = client();
        Response reply = form(MICROSOFT + "devicecode", Map.of("client_id", client, "scope", SCOPE));
        if (!reply.ok()) throw new IOException("无法开始微软授权，请检查 Azure 应用的设备登录配置");
        JsonObject data = reply.body();
        int interval = (int) Math.clamp(ResourceCatalog.number(data, "interval", 5), 5, 60);
        int expiry = (int) Math.clamp(ResourceCatalog.number(data, "expires_in", 900), 1, 1800);
        String uri = text(data, "verification_uri_complete", required(data, "verification_uri"));
        URI page = URI.create(uri);
        if (!"https".equals(page.getScheme())
            || !Set.of("www.microsoft.com", "microsoft.com", "login.microsoftonline.com", "microsoftonline.com",
                "login.live.com").contains(page.getHost()) || page.getRawUserInfo() != null || page.getPort() != -1) {
            throw new IOException("微软授权页面地址无效");
        }
        String id = UUID.randomUUID().toString();
        long now = nanos.getAsLong();
        flows.entrySet().removeIf(entry -> entry.getValue().expiry <= now);
        var flow = new Flow(required(data, "device_code"), client, now, expiry, interval);
        flows.put(id, flow);
        var result = new JsonObject();
        result.addProperty("flowId", id);
        result.addProperty("userCode", required(data, "user_code"));
        result.addProperty("verificationUri", uri);
        result.addProperty("interval", interval);
        result.addProperty("expiresIn", expiry);
        return result;
    }

    void cancel(String id) {
        Flow flow = flows.remove(id);
        if (flow == null) return;
        synchronized (flow) { flow.cancelled = true; }
    }

    JsonObject poll(String id) throws IOException {
        Flow flow = flows.get(id);
        if (flow == null) throw new IOException("此登录请求已取消或失效");
        synchronized (flow) {
            long now = nanos.getAsLong();
            if (flow.cancelled || flows.get(id) != flow) throw new IOException("登录已取消");
            if (now >= flow.expiry) {
                flows.remove(id, flow);
                return outcome("expired", "授权已过期，请重新登录。", 0);
            }
            if (flow.busy) return outcome("pending", null, flow.interval);
            if (flow.next > now) {
                return outcome("pending", null, Math.max(1, (int) Duration.ofNanos(flow.next - now).toSeconds()));
            }
            flow.busy = true;
            flow.next = now + Duration.ofSeconds(flow.interval).toNanos();
        }
        try {
            Response response = form(MICROSOFT + "token", Map.of("client_id", flow.client,
                "grant_type", "urn:ietf:params:oauth:grant-type:device_code", "device_code", flow.device, "scope", SCOPE));
            if (!response.ok()) return pollError(id, flow, text(response.body(), "error", ""));
            Exchange game = exchange(required(response.body(), "access_token"));
            synchronized (flow) {
                if (flow.cancelled || flows.get(id) != flow) throw new IOException("登录已取消");
                JsonObject account = account(game.profile(), new JsonObject());
                String key = required(account, "id");
                vault.save(key, secret(flow.client, required(response.body(), "refresh_token"), game));
                accounts.save(account);
                flows.remove(id, flow);
                JsonObject result = outcome("success", null, 0);
                result.add("account", account);
                return result;
            }
        } finally {
            synchronized (flow) { flow.busy = false; }
        }
    }

    private JsonObject pollError(String id, Flow flow, String error) throws IOException {
        synchronized (flow) {
            if (flow.cancelled || flows.get(id) != flow) throw new IOException("登录已取消");
            if ("slow_down".equals(error) || "authorization_pending".equals(error)) {
                if ("slow_down".equals(error)) flow.interval += 5;
                flow.next = nanos.getAsLong() + Duration.ofSeconds(flow.interval).toNanos();
                return outcome("pending", null, flow.interval);
            }
            flows.remove(id, flow);
            return switch (error) {
                case "authorization_declined", "access_denied" -> outcome("denied", "你取消了微软授权，可以重新登录。", 0);
                case "expired_token" -> outcome("expired", "授权已过期，请重新登录。", 0);
                default -> outcome("failed", "微软授权失败，请重新尝试。", 0);
            };
        }
    }

    synchronized Session session(JsonObject current) throws IOException {
        String key = required(current, "id");
        if (!"microsoft".equals(text(current, "kind", ""))) throw new IOException("此入口需要微软账号");
        JsonObject stored = vault.load(key);
        String cached = text(stored, "minecraftToken", "");
        if (!cached.isBlank() && ResourceCatalog.number(stored, "minecraftExpiresAt", 0) > Instant.now().getEpochSecond() + 60) {
            return new Session(cached, "msa");
        }
        String client = text(stored, "clientId", client());
        String refresh = required(stored, "refresh");
        Map<String, String> input = Map.of("client_id", client, "grant_type", "refresh_token", "refresh_token", refresh, "scope", SCOPE);
        Response grant = form(MICROSOFT + "token", input);
        if (!grant.ok()) grant = form("https://login.live.com/oauth20_token.srf", input);
        if (!grant.ok()) throw new IOException("登录已过期，请重新登录");
        Exchange game = exchange(required(grant.body(), "access_token"));
        if (!required(current, "uuid").equals(required(game.profile(), "id"))) {
            throw new IOException("刷新后账号身份发生变化，请重新登录");
        }
        vault.save(key, secret(client, text(grant.body(), "refresh_token", refresh), game));
        accounts.save(account(game.profile(), current));
        return new Session(game.token(), "msa");
    }

    synchronized JsonObject sync(JsonObject current) throws IOException {
        String id = required(current, "id");
        JsonObject secret = vault.load(id);
        String token = text(secret, "minecraftToken", "");
        if (!token.isEmpty() && ResourceCatalog.number(secret, "minecraftExpiresAt", 0) > Instant.now().getEpochSecond() + 60) {
            var response = network.request(PROFILE, null, null, token);
            if (response.ok()) {
                if (!required(current, "uuid").equals(required(response.body(), "id"))) throw new IOException("皮肤档案与当前账号不一致");
                return accounts.save(account(response.body(), current));
            }
        }
        session(current);
        return accounts.find(id);
    }

    synchronized void remove(String id) throws IOException {
        // Remove this launcher's saved secret before removing its visible account.
        vault.remove(id);
        accounts.remove(id);
    }

    private Exchange exchange(String access) throws IOException {
        String ticket = access.startsWith("d=") ? access : "d=" + access;
        JsonObject xbox = post("https://user.auth.xboxlive.com/user/authenticate", Map.of("Properties",
            Map.of("AuthMethod", "RPS", "SiteName", "user.auth.xboxlive.com", "RpsTicket", ticket),
            "RelyingParty", "http://auth.xboxlive.com", "TokenType", "JWT"), "Xbox Live 身份验证失败");
        JsonObject xsts = post("https://xsts.auth.xboxlive.com/xsts/authorize", Map.of("Properties",
            Map.of("SandboxId", "RETAIL", "UserTokens", new String[]{required(xbox, "Token")}),
            "RelyingParty", "rp://api.minecraftservices.com/", "TokenType", "JWT"), "Xbox 授权失败，请检查账号地区和家庭组设置");
        String user = hash(xsts);
        if (!hash(xbox).equals(user)) throw new IOException("Xbox 与 XSTS 返回了不同的用户身份，请重新登录");
        JsonObject minecraft = post(GAME + "/authentication/login_with_xbox",
            Map.of("identityToken", "XBL3.0 x=" + user + ";" + required(xsts, "Token")), "Minecraft 身份验证失败");
        String token = required(minecraft, "access_token");
        if (!network.request(GAME + "/entitlements/mcstore", null, null, token).ok()) {
            throw new IOException("Minecraft 所有权服务暂时无法验证，请稍后重试");
        }
        Response response = network.request(PROFILE, null, null, token);
        if (!response.ok()) throw new IOException(response.status() == 404 ? "该 Microsoft 账号没有 Java 版 Minecraft 档案"
            : "无法获取 Minecraft 档案，请稍后重试");
        return new Exchange(response.body(), token, ResourceCatalog.number(minecraft, "expires_in", 0));
    }

    private static JsonObject account(JsonObject profile, JsonObject existing) throws IOException {
        String id = required(profile, "id");
        String name = required(profile, "name");
        if (!id.matches("[a-fA-F0-9]{32}") || !name.matches("[A-Za-z0-9_]{1,16}")) {
            throw new IOException("Minecraft 返回的档案标识无效");
        }
        var result = existing.deepCopy();
        result.addProperty("id", "microsoft-" + id);
        result.addProperty("name", name);
        result.addProperty("uuid", id);
        result.addProperty("kind", "microsoft");
        result.add("skin", JsonNull.INSTANCE);
        result.addProperty("skinModel", "Classic");
        for (var item : array(profile.get("skins"))) {
            var skin = object(item);
            if (!"ACTIVE".equals(text(skin, "state", ""))) continue;
            result.addProperty("skin", texture(text(skin, "url", "")));
            result.addProperty("skinModel", "SLIM".equals(text(skin, "variant", "")) ? "Slim" : "Classic");
            break;
        }
        var capes = new JsonArray();
        result.addProperty("capeId", "");
        result.add("cape", JsonNull.INSTANCE);
        for (var item : array(profile.get("capes"))) {
            var cape = object(item);
            var value = new JsonObject();
            String image = texture(text(cape, "url", ""));
            String capeId = required(cape, "id");
            boolean active = "ACTIVE".equals(text(cape, "state", ""));
            value.addProperty("id", capeId);
            value.addProperty("texture", image);
            value.addProperty("name", text(cape, "alias", "正版披风"));
            value.addProperty("active", active);
            if (active) {
                result.addProperty("cape", image);
                result.addProperty("capeId", capeId);
            }
            capes.add(value);
        }
        result.add("capes", capes);
        var types = new JsonArray();
        types.add("skin");
        result.add("uploadableTextures", types);
        return result;
    }

    private static String texture(String url) throws IOException {
        String secure = url.replaceFirst("^http://", "https://");
        if (ResourceCatalog.https(secure) != null && "textures.minecraft.net".equals(URI.create(secure).getHost())
            && URI.create(secure).getPort() == -1) return secure;
        throw new IOException("Minecraft 返回的皮肤地址无效");
    }

    private static String client() throws IOException {
        String id = System.getProperty("kynex.microsoftClient", ID);
        try { return UUID.fromString(id).toString(); }
        catch (IllegalArgumentException invalid) { throw new IOException("内置的微软应用标识无效"); }
    }

    private static JsonObject secret(String client, String refresh, Exchange profile) {
        var value = new JsonObject();
        value.addProperty("clientId", client);
        value.addProperty("refresh", refresh);
        value.addProperty("minecraftToken", profile.token());
        value.addProperty("minecraftExpiresAt", Instant.now().getEpochSecond() + profile.seconds());
        return value;
    }

    private static String hash(JsonObject data) throws IOException {
        var members = array(object(data.get("DisplayClaims")).get("xui"));
        String hash = members.isEmpty() ? "" : text(object(members.get(0)), "uhs", "");
        if (!hash.matches("[0-9]+")) throw new IOException("Xbox 用户信息缺失");
        return hash;
    }

    private JsonObject post(String url, Map<String, ?> body, String error) throws IOException {
        Response result = network.request(url, JsonFiles.JSON.toJson(body), "application/json", null);
        if (!result.ok()) throw new IOException(error);
        return result.body();
    }

    private Response form(String url, Map<String, String> fields) throws IOException {
        var parts = new LinkedHashMap<String, String>();
        fields.forEach((key, value) -> parts.put(key, URLEncoder.encode(value, StandardCharsets.UTF_8)));
        String body = parts.entrySet().stream().map(row -> row.getKey() + "=" + row.getValue())
            .collect(java.util.stream.Collectors.joining("&"));
        return network.request(url, body, "application/x-www-form-urlencoded", null);
    }

    private static JsonObject outcome(String status, String message, int retry) {
        var result = new JsonObject();
        result.addProperty("status", status);
        if (message != null) result.addProperty("message", message);
        if (retry > 0) result.addProperty("retryAfter", retry);
        return result;
    }

    private static Response https(String url, String body, String mime, String bearer) throws IOException {
        URI destination = URI.create(url);
        if (!"https".equals(destination.getScheme()) || !HOSTS.contains(destination.getHost())
            || destination.getPort() != -1 || destination.getRawUserInfo() != null) {
            throw new IOException("Microsoft 登录服务地址无效");
        }
        return httpsRequest(destination, body, mime, bearer);
    }

    static Response httpsRequest(URI destination, String body, String mime, String bearer) throws IOException {
        var request = (HttpsURLConnection) destination.toURL().openConnection();
        request.setInstanceFollowRedirects(false);
        request.setConnectTimeout(8000);
        request.setReadTimeout(12000);
        request.setRequestProperty("Accept", "application/json");
        try {
            if (bearer != null) request.setRequestProperty("Authorization", "Bearer " + bearer);
            if (body != null) {
                byte[] data = body.getBytes(StandardCharsets.UTF_8);
                request.setRequestMethod("POST");
                request.setDoOutput(true);
                request.setFixedLengthStreamingMode(data.length);
                request.setRequestProperty("Content-Type", mime);
                try (var output = request.getOutputStream()) { output.write(data); }
            }
            int status = request.getResponseCode();
            if (status >= 300 && status < 400) throw new IOException("账号服务返回了意外的跳转");
            try (var input = status >= 400 ? request.getErrorStream() : request.getInputStream()) {
                if (input == null) return new Response(status, new JsonObject());
                byte[] bytes = input.readNBytes(1024 * 1024 + 1);
                if (bytes.length > 1024 * 1024) throw new IOException("账号服务响应超过大小限制");
                var result = JsonFiles.JSON.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonObject.class);
                return new Response(status, result == null ? new JsonObject() : result);
            }
        } catch (JsonParseException error) {
            throw new IOException("账号服务返回了无法识别的数据");
        } finally {
            request.disconnect();
        }
    }
}
