package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.keke.kynex.account.AccountStore;
import com.keke.kynex.account.CredentialVault;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;

final class ExternalLogin {
    private static final String AGENT = "https://authlib-injector.yushi.moe/artifact/latest.json";
    private final AccountStore accounts;
    private final CredentialVault vault;
    private final MicrosoftLogin.Network network;

    ExternalLogin(AccountStore accounts, CredentialVault vault) {
        this(accounts, vault, (url, body, mime, bearer) -> MicrosoftLogin.httpsRequest(URI.create(url), body, mime, bearer));
    }

    ExternalLogin(AccountStore accounts, CredentialVault vault, MicrosoftLogin.Network network) {
        this.accounts = accounts;
        this.vault = vault;
        this.network = network;
    }

    JsonObject server(JsonObject request) throws IOException {
        String origin = origin(required(request, "server"));
        var response = network.request(origin, null, null, null);
        if (!response.ok() || !(response.body().get("meta") instanceof JsonObject)
            && !(response.body().get("skinDomains") instanceof JsonArray)) {
            throw new IOException("此地址不是可识别的 Yggdrasil 认证服务器");
        }
        var result = new JsonObject();
        result.addProperty("name", text(object(response.body().get("meta")), "serverName", "Yggdrasil 认证服务器"));
        return result;
    }

    JsonObject login(JsonObject request) throws IOException {
        String origin = origin(required(request, "server"));
        JsonObject payload = post(origin + "/authserver/authenticate", Map.of("agent", Map.of("name", "Minecraft", "version", 1),
            "username", required(request, "email"), "password", required(request, "password"),
            "clientToken", UUID.randomUUID().toString(), "requestUser", true), "外置登录失败，请检查地址和凭据");
        var profiles = array(payload.get("availableProfiles"));
        String selected = text(request, "profile", "");
        if (selected.isEmpty() && profiles.size() > 1) {
            var available = new JsonObject();
            available.add("profiles", profiles);
            return available;
        }
        var profile = object(payload.get("selectedProfile"));
        if (!selected.isEmpty()) {
            profile = profiles.asList().stream().map(LaunchManifest::object)
                .filter(item -> selected.equals(text(item, "id", ""))).findFirst()
                .orElseThrow(() -> new IOException("找不到选择的角色"));
        } else if (profile.isEmpty() && !profiles.isEmpty()) profile = profiles.get(0).getAsJsonObject();
        String uuid = text(profile, "id", "");
        if (!uuid.matches("[a-fA-F0-9]{32}")) throw new IOException("此账号没有可用的 Minecraft 角色，请先创建角色");
        String name = required(profile, "name");
        String id;
        try {
            id = "external-" + HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(origin.getBytes(StandardCharsets.UTF_8)))
                + "-" + uuid;
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IOException("无法生成外置账号标识", unavailable);
        }
        var result = new JsonObject();
        result.addProperty("id", id);
        result.addProperty("uuid", uuid);
        result.addProperty("name", name);
        result.addProperty("kind", "external");
        result.addProperty("server", origin);
        JsonObject data = token(payload);
        if (!uuid.equals(text(object(payload.get("selectedProfile")), "id", ""))) data = refresh(origin, result, data);
        vault.save(id, data);
        try { result = profile(result); }
        catch (IOException | IllegalArgumentException ignored) {
            // An unavailable appearance endpoint does not invalidate a working account.
        }
        return accounts.save(result);
    }

    synchronized MicrosoftLogin.Session session(JsonObject account) throws IOException {
        String id = required(account, "id");
        JsonObject fresh = refresh(origin(required(account, "server")), account, vault.load(id));
        vault.save(id, fresh);
        return new MicrosoftLogin.Session(required(fresh, "token"), "legacy");
    }

    String agent(Path root, JsonObject account, GameDownloads downloads, MinecraftInstaller.Progress progress) throws IOException {
        var release = downloads.document(AGENT, false, "", value -> value instanceof JsonObject, progress::stopped).value().getAsJsonObject();
        String hash = required(object(release.get("checksums")), "sha256");
        String url = required(release, "download_url");
        if (!hash.matches("[a-fA-F0-9]{64}") || !url.startsWith("https://authlib-injector.yushi.moe/artifact/")) {
            throw new IOException("外置认证组件的发布信息无效");
        }
        Path jar = GameFiles.target(root, "cache/authlib-injector.jar");
        downloads.file(url, false, jar, hash, GameDownloads.FILE_LIMIT, progress::stopped);
        return "-javaagent:" + jar + "=" + origin(required(account, "server"));
    }

    JsonObject sync(JsonObject account) throws IOException {
        return accounts.save(profile(account));
    }

    private JsonObject profile(JsonObject account) throws IOException {
        String uuid = required(account, "uuid");
        if (!uuid.matches("[a-fA-F0-9]{32}")) throw new IOException("外置角色 UUID 无效");
        String origin = origin(required(account, "server"));
        var response = network.request(origin + "/sessionserver/session/minecraft/profile/" + uuid + "?unsigned=true", null, null, null);
        if (!response.ok() || !uuid.equals(text(response.body(), "id", ""))) throw new IOException("无法同步此外置角色的皮肤");
        var permissions = new JsonArray();
        var fields = new JsonObject();
        for (var item : array(response.body().get("properties"))) {
            var property = object(item);
            String value = text(property, "value", "");
            switch (text(property, "name", "")) {
                case "textures" -> {
                    if (value.length() > 256 * 1024) throw new IOException("外置皮肤档案过大");
                    try {
                        var decoded = new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8);
                        fields = object(object(JsonFiles.JSON.fromJson(decoded, JsonObject.class)).get("textures"));
                    } catch (JsonParseException | IllegalArgumentException invalid) {
                        throw new IOException("外置皮肤档案格式无效");
                    }
                }
                case "uploadableTextures" -> {
                    for (String kind : value.split(",")) {
                        if (Set.of("skin", "cape").contains(kind.strip())) permissions.add(kind.strip());
                    }
                }
                default -> { /* Other profile properties belong to the authentication server. */ }
            }
        }
        var output = account.deepCopy();
        var skin = object(fields.get("SKIN"));
        var cape = object(fields.get("CAPE"));
        String image = ResourceCatalog.https(text(skin, "url", "").replaceFirst("^http://", "https://"));
        String capeUrl = ResourceCatalog.https(text(cape, "url", "").replaceFirst("^http://", "https://"));
        output.addProperty("skin", image);
        output.addProperty("skinModel", "slim".equals(text(object(skin.get("metadata")), "model", "")) ? "Slim" : "Classic");
        output.addProperty("cape", capeUrl);
        output.addProperty("capeId", capeUrl == null ? "" : "current");
        var capes = new JsonArray();
        if (capeUrl != null) {
            var row = new JsonObject();
            row.addProperty("texture", capeUrl);
            row.addProperty("id", "current");
            row.addProperty("name", "当前外置披风");
            row.addProperty("active", true);
            capes.add(row);
        }
        output.add("capes", capes);
        output.add("uploadableTextures", permissions);
        return output;
    }

    private JsonObject refresh(String origin, JsonObject account, JsonObject token) throws IOException {
        var profile = Map.of("id", required(account, "uuid"), "name", required(account, "name"));
        JsonObject response = post(origin + "/authserver/refresh", Map.of("accessToken", required(token, "token"),
            "clientToken", required(token, "clientToken"), "selectedProfile", profile), "外置会话已过期，请重新登录");
        String uuid = text(object(response.get("selectedProfile")), "id", profile.get("id"));
        if (!uuid.equals(profile.get("id"))) throw new IOException("外置会话返回了不同的角色");
        return token(response);
    }

    private JsonObject post(String url, Map<String, ?> body, String error) throws IOException {
        var response = network.request(url, JsonFiles.JSON.toJson(body), "application/json", null);
        if (!response.ok()) throw new IOException(error);
        return response.body();
    }

    private static JsonObject token(JsonObject payload) {
        var token = new JsonObject();
        token.addProperty("token", required(payload, "accessToken"));
        token.addProperty("clientToken", required(payload, "clientToken"));
        return token;
    }

    static String origin(String origin) throws IOException {
        String value = origin.strip().replaceFirst("/+$", "");
        if (ResourceCatalog.https(value) == null) throw new IOException("请选择有效的 HTTPS 外置认证地址");
        URI uri = URI.create(value);
        if (uri.getRawFragment() != null || uri.getRawQuery() != null) throw new IOException("外置认证服务地址不能包含查询参数");
        return value;
    }
}
