package com.keke.kynex.core;

import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.keke.kynex.account.CredentialVault;
import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static com.keke.kynex.core.AssistantProviders.fields;
import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;

final class VoiceTranscription {
    private static final Map<String, String> FORMATS = Map.of("audio/webm", "webm", "audio/ogg", "ogg", "audio/wav", "wav", "audio/mp4", "m4a");
    private final String credential;
    private final CredentialVault vault;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

    VoiceTranscription(Path root, CredentialVault vault) {
        credential = "ai-voice:" + root;
        this.vault = vault;
    }

    synchronized JsonObject config(JsonObject payload) throws IOException {
        JsonObject current = saved();
        switch (text(payload, "op", "list")) {
            case "list" -> { }
            case "save" -> {
                var next = fields("name", "语音转写", "model", required(payload, "model"), "endpoint", required(payload, "endpoint"));
                var origin = AssistantProviders.validate(next);
                String key = text(payload, "key", "");
                if (key.isEmpty() && origin.toString().equals(text(current, "endpoint", ""))) key = text(current, "key", "");
                AssistantProviders.validateKey(key, origin);
                next.addProperty("key", key);
                vault.save(credential, next);
                current = next;
            }
            case "clear" -> {
                vault.remove(credential);
                current = new JsonObject();
            }
            default -> throw new IOException("未知语音设置操作");
        }
        String endpoint = text(current, "endpoint", ""), model = text(current, "model", "");
        return fields("endpoint", endpoint, "model", model, "configured", !endpoint.isBlank() && !model.isBlank());
    }

    JsonObject transcribe(JsonObject input) throws IOException, InterruptedException {
        JsonObject config = saved();
        if (!config.has("endpoint")) throw new IOException("请先在 AI 设置中配置语音转写服务");
        config.addProperty("name", "语音转写");
        var destination = AssistantProviders.validate(config);
        String key = text(config, "key", "");
        AssistantProviders.validateKey(key, destination);
        String mime = required(input, "mime");
        long duration = ResourceCatalog.number(input, "durationMs", 0);
        if (duration <= 0 || duration > 60_000 || !FORMATS.containsKey(mime)) throw new IOException("请选择不超过 60 秒的录音");
        String encoded = required(input, "audio");
        if (encoded.length() > 14 * 1024 * 1024) throw new IOException("录音超过 10 MB");
        byte[] audio;
        try { audio = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException invalid) { throw new IOException("录音编码无效"); }
        if (audio.length == 0 || audio.length > 10 * 1024 * 1024) throw new IOException("录音为空或超过 10 MB");
        String boundary = "KXL-" + UUID.randomUUID();
        String header = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n" + required(config, "model")
            + "\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\njson\r\n--" + boundary
            + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"recording." + FORMATS.get(mime) + "\"\r\nContent-Type: "
            + mime + "\r\n\r\n";
        var body = HttpRequest.BodyPublishers.ofByteArrays(List.of(header.getBytes(StandardCharsets.UTF_8), audio,
            ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.US_ASCII)));
        var request = HttpRequest.newBuilder(destination).timeout(Duration.ofSeconds(45)).POST(body)
            .header("Content-Type", "multipart/form-data; boundary=" + boundary);
        if (!key.isEmpty()) request.header("Authorization", "Bearer " + key);
        for (int attempt = 0; attempt < 2; attempt++) {
            if (attempt > 0) Thread.sleep(700);
            HttpResponse<java.io.InputStream> response;
            try { response = http.send(request.build(), HttpResponse.BodyHandlers.ofInputStream()); }
            catch (IOException unavailable) {
                if (attempt == 0) continue;
                throw new IOException("语音服务连接失败，请检查地址和网络");
            }
            try (var stream = response.body()) {
                int status = response.statusCode();
                if (attempt == 0 && Set.of(500, 502, 503, 504).contains(status)) continue;
                if (status < 200 || status >= 300) throw new IOException("语音服务未接收录音（HTTP " + status + "）");
                byte[] bytes = stream.readNBytes(1024 * 1024 + 1);
                if (bytes.length > 1024 * 1024) throw new IOException("语音服务返回内容过大");
                var decoded = JsonFiles.JSON.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonObject.class);
                String answer = decoded == null ? "" : text(decoded, "text", "");
                if (answer.isBlank() || answer.length() > 12_000) throw new IOException("语音服务未识别到有效文字");
                return fields("text", AssistantService.redact(answer, key));
            } catch (JsonParseException invalid) { throw new IOException("语音服务没有返回可读取的文字"); }
        }
        throw new IOException("语音服务暂时不可用");
    }

    private JsonObject saved() {
        try { return vault.load(credential); }
        catch (IOException unavailable) { return new JsonObject(); }
    }
}
