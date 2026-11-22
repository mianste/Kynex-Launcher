package com.keke.kynex.core;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.keke.kynex.account.AccountStore;
import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import javax.net.ssl.HttpsURLConnection;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;

final class SkinAppearance {
    private static final int LIMIT = 5 * 1024 * 1024;
    private static final String PROFILE = "https://api.minecraftservices.com/minecraft/profile";
    private static final String PNG = "data:image/png;base64,";
    private final Path root;
    private final AccountStore accounts;
    private final MicrosoftLogin microsoft;
    private final ExternalLogin external;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();

    SkinAppearance(Path root, AccountStore accounts, MicrosoftLogin microsoft, ExternalLogin external) {
        this.root = root;
        this.accounts = accounts;
        this.microsoft = microsoft;
        this.external = external;
    }

    String texture(JsonObject payload) throws Exception {
        URI url = publicImage(required(payload, "url"));
        boolean cape = LaunchManifest.is(payload.get("cape"), true);
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(url.toString().getBytes(StandardCharsets.UTF_8)));
        Path cache = GameFiles.target(root, "cache/appearance/" + hash + ".png");
        try {
            if (Files.isRegularFile(cache, LinkOption.NOFOLLOW_LINKS) && Files.size(cache) <= LIMIT) {
                return validate(Files.readAllBytes(cache), cape);
            }
        } catch (IOException corrupt) { /* The source can replace a damaged cached texture. */ }
        byte[] bytes = receive(url, LIMIT);
        String result = validate(bytes, cape);
        try { JsonFiles.atomicWrite(cache, bytes); }
        catch (IOException ignored) { /* Continue using the validated downloaded texture. */ }
        return result;
    }

    JsonObject importSkin(JsonObject payload) throws IOException {
        String input = required(payload, "value").strip();
        String name, model = null, url;
        switch (required(payload, "kind")) {
            case "url" -> {
                url = input;
                name = "图片链接";
            }
            case "username" -> {
                if (!input.matches("[A-Za-z0-9_]{1,16}")) throw new IOException("玩家名应为 1–16 位英文、数字或下划线");
                JsonObject player = json(receive(URI.create("https://api.mojang.com/users/profiles/minecraft/" + input), 64 * 1024));
                String uuid = required(player, "id");
                if (!uuid.matches("[a-fA-F0-9]{32}")) throw new IOException("玩家 UUID 无效");
                JsonObject session = json(receive(URI.create("https://sessionserver.mojang.com/session/minecraft/profile/" + uuid), 256 * 1024));
                String value = array(session.get("properties")).asList().stream().map(LaunchManifest::object)
                    .filter(row -> "textures".equals(text(row, "name", ""))).map(row -> text(row, "value", ""))
                    .findFirst().orElseThrow(() -> new IOException("玩家档案中没有皮肤"));
                JsonObject skin;
                try { skin = object(object(json(Base64.getDecoder().decode(value)).get("textures")).get("SKIN")); }
                catch (IllegalArgumentException invalid) { throw new IOException("玩家皮肤档案无法读取"); }
                url = required(skin, "url").replaceFirst("^http://", "https://");
                if (!"textures.minecraft.net".equals(publicImage(url).getHost())) throw new IOException("玩家皮肤地址无效");
                model = "slim".equals(text(object(skin.get("metadata")), "model", "")) ? "Slim" : "Classic";
                name = required(player, "name");
            }
            default -> throw new IOException("不支持的皮肤导入方式");
        }
        byte[] data = receive(publicImage(url), LIMIT);
        var result = new JsonObject();
        result.addProperty("name", name);
        result.addProperty("model", model);
        result.addProperty("base64", validate(data, false).substring(PNG.length()));
        return result;
    }

    JsonObject apply(JsonObject payload, boolean cape) throws Exception {
        String id = required(payload, "accountId");
        JsonObject account = accounts.find(id);
        String kind = required(account, "kind");
        String model = cape ? "" : required(payload, "model");
        if (!cape && !model.equals("Classic") && !model.equals("Slim")) throw new IOException("皮肤模型无效");
        String input = cape ? text(payload, "texture", null) : required(payload, "texture");
        byte[] image = input == null ? null : TextureFiles.png(input, cape);
        if (kind.equals("microsoft")) {
            if (cape && image != null) throw new IOException("正版账号只能选择已拥有的披风");
            if (!cape && ByteBuffer.wrap(image).getInt(16) != 64) throw new IOException("正版账号皮肤必须为 64×64 或 64×32 PNG");
            String token = microsoft.session(account).token();
            if (cape) {
                String capeId = text(payload, "capeId", "");
                String url = PROFILE + "/capes/active";
                if (capeId.isEmpty()) send(url, "DELETE", token, null, HttpRequest.BodyPublishers.noBody());
                else {
                    if (array(accounts.find(id).get("capes")).asList().stream().noneMatch(row -> capeId.equals(text(object(row), "id", ""))))
                        throw new IOException("只能选择当前正版账号拥有的披风");
                    var choice = new JsonObject();
                    choice.addProperty("capeId", capeId);
                    send(url, "PUT", token, "application/json", HttpRequest.BodyPublishers.ofString(choice.toString()));
                }
            } else sendImage(PROFILE + "/skins", "POST", token, "skin", image, "variant", model.toLowerCase(Locale.ROOT));
            try { account = microsoft.sync(accounts.find(id)); }
            catch (IOException failure) { throw new IOException("外观已提交，重新同步失败：" + failure.getMessage()); }
        } else if (kind.equals("external")) {
            account = external.sync(account);
            String type = cape ? "cape" : "skin";
            if (!array(account.get("uploadableTextures")).asList().stream().anyMatch(value -> value.isJsonPrimitive() && type.equals(value.getAsString()))) {
                throw new IOException("此认证服务器未开放" + (cape ? "披风" : "皮肤") + "修改权限");
            }
            String token = external.session(account).token();
            String address = ExternalLogin.origin(required(account, "server")) + "/api/user/profile/" + required(account, "uuid") + "/" + type;
            if (image == null) send(address, "DELETE", token, null, HttpRequest.BodyPublishers.noBody());
            else sendImage(address, "PUT", token, type, image, cape ? null : "model", "Slim".equals(model) ? "slim" : "");
            try { account = external.sync(account); }
            catch (IOException failure) { throw new IOException("外观已提交，重新同步失败：" + failure.getMessage()); }
        } else if (kind.equals("offline")) {
            if (cape) account.addProperty("cape", input);
            else {
                account.addProperty("skin", input);
                account.addProperty("skinModel", model);
            }
            account = accounts.save(account);
        } else throw new IOException("账号类型无效");
        var result = new JsonObject();
        result.add("account", account);
        result.addProperty("remote", !kind.equals("offline"));
        return result;
    }

    private void sendImage(String endpoint, String method, String token, String name, byte[] png, String field, String value)
        throws IOException, InterruptedException {
        String boundary = "KXL-" + UUID.randomUUID();
        var parts = new ArrayList<byte[]>();
        if (field != null) parts.add(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + field
            + "\"\r\n\r\n" + value + "\r\n").getBytes(StandardCharsets.UTF_8));
        parts.add(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + name
            + ".png\"\r\nContent-Type: image/png\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        parts.add(png);
        parts.add(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        send(endpoint, method, token, "multipart/form-data; boundary=" + boundary, HttpRequest.BodyPublishers.ofByteArrays(parts));
    }

    private void send(String endpoint, String method, String token, String type, HttpRequest.BodyPublisher body)
        throws IOException, InterruptedException {
        var builder = HttpRequest.newBuilder(URI.create(endpoint)).header("Authorization", "Bearer " + token)
            .timeout(Duration.ofSeconds(30)).method(method, body);
        if (type != null) builder.header("Content-Type", type);
        int status;
        try { status = http.send(builder.build(), HttpResponse.BodyHandlers.discarding()).statusCode(); }
        catch (IOException connection) { throw new IOException("无法连接皮肤或披风服务"); }
        if (status < 200 || status >= 300) throw new IOException("更新皮肤或披风失败（HTTP " + status + "）");
    }

    private static String validate(byte[] bytes, boolean cape) throws IOException {
        if (bytes.length > LIMIT) throw new IOException("图片文件超过 5 MB");
        String encoded = PNG + Base64.getEncoder().encodeToString(bytes);
        TextureFiles.png(encoded, cape);
        return encoded;
    }

    private static JsonObject json(byte[] bytes) throws IOException {
        try {
            JsonElement item = JsonFiles.JSON.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonElement.class);
            if (item == null || item == JsonNull.INSTANCE || !item.isJsonObject()) throw new IOException("玩家档案无法读取");
            return item.getAsJsonObject();
        } catch (JsonParseException invalid) { throw new IOException("玩家档案无法读取"); }
    }

    private static URI publicImage(String url) throws IOException {
        try {
            URI uri = URI.create(url);
            String host = uri.getHost();
            if ("https".equals(uri.getScheme()) && host != null && uri.getRawUserInfo() == null && uri.getRawFragment() == null
                && (uri.getPort() == -1 || uri.getPort() == 443) && !host.contains(":")) return uri;
        } catch (IllegalArgumentException invalid) { /* Use a validation message without the user-provided URL. */ }
        throw new IOException("请输入有效的 HTTPS 公网图片直链");
    }

    private static byte[] receive(URI url, int limit) throws IOException {
        for (int index = 0; index < 5; index++) {
            for (InetAddress address : InetAddress.getAllByName(url.getHost())) {
                if (address.isLoopbackAddress() || address.isAnyLocalAddress() || address.isLinkLocalAddress()
                    || address.isSiteLocalAddress() || address.isMulticastAddress() || uniqueLocal(address)) throw new IOException("请使用公网图片直链");
            }
            var request = (HttpsURLConnection) url.toURL().openConnection();
            request.setInstanceFollowRedirects(false);
            request.setConnectTimeout(7000);
            request.setReadTimeout(10000);
            request.setRequestProperty("User-Agent", "Kynex Launcher/1.7.0 (skin preview)");
            try {
                int status = request.getResponseCode();
                if (status >= 300 && status < 400 && request.getHeaderField("Location") != null) {
                    url = publicImage(url.resolve(request.getHeaderField("Location")).toString());
                    continue;
                }
                if (status != 200) throw new IOException("没有找到玩家或皮肤（HTTP " + status + "）");
                try (var stream = request.getInputStream()) {
                    if (request.getContentLengthLong() > limit) throw new IOException("远端文件超过体积限制");
                    byte[] bytes = stream.readNBytes(limit + 1);
                    if (bytes.length > limit) throw new IOException("远端文件超过体积限制");
                    return bytes;
                }
            } finally { request.disconnect(); }
        }
        throw new IOException("图片跳转次数过多");
    }

    private static boolean uniqueLocal(InetAddress address) {
        byte[] bytes = address.getAddress();
        return bytes.length == 16 ? (bytes[0] & 254) == 252 : (bytes[0] & 255) == 100 && (bytes[1] & 192) == 64;
    }
}
