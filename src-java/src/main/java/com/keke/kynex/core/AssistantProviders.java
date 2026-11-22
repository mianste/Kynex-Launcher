package com.keke.kynex.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.keke.kynex.account.CredentialVault;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.UUID;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.array;
import static com.keke.kynex.core.LaunchManifest.object;

final class AssistantProviders {
    private static final String DEEPSEEK = "https://api.deepseek.com/chat/completions";
    private final Path root;
    private final CredentialVault vault;

    AssistantProviders(Path root, CredentialVault vault) {
        this.root = root;
        this.vault = vault;
    }

    synchronized JsonObject models(JsonObject payload) throws IOException {
        JsonObject config = profile();
        String operation = text(payload, "op", "list");
        String id = text(payload, "id", "");
        JsonArray items = array(config.get("items"));
        JsonObject old = find(items, id);
        switch (operation) {
            case "list" -> { }
            case "save" -> {
                URI endpoint = validate(payload);
                if (id.equals("deepseek") && !DEEPSEEK.equals(endpoint.toString())) throw new IOException("内置 DeepSeek 地址不可更改");
                if (id.isEmpty()) id = UUID.randomUUID().toString();
                if (!id.matches("[A-Za-z0-9_-]{1,128}")) throw new IOException("模型标识无效");
                String key = text(payload, "key", "");
                if (key.isEmpty()) {
                    if (old != null && !endpoint.toString().equals(required(old, "endpoint")) && !text(old, "key", "").isEmpty()) {
                        throw new IOException("API 地址已变更，请重新填写 Key");
                    }
                    key = old == null ? id.equals("deepseek") ? key() : "" : text(old, "key", "");
                }
                validateKey(key, endpoint);
                if (old != null) items.remove(old);
                items.add(fields("id", id, "name", required(payload, "name"), "endpoint", endpoint.toString(), "model", required(payload, "model"),
                    "supportsVision", LaunchManifest.is(payload.get("supportsVision"), true), "key", key));
                config.addProperty("active", id);
            }
            case "select", "delete" -> {
                if (old == null && !id.equals("deepseek")) throw new IOException("模型不存在");
                if (operation.equals("select")) config.addProperty("active", id);
                else {
                    if (id.equals("deepseek")) throw new IOException("内置服务只能清除密钥");
                    items.remove(old);
                    if (id.equals(text(config, "active", ""))) config.addProperty("active", "deepseek");
                }
            }
            case "clear_key" -> {
                if (old != null) old.addProperty("key", "");
                if (id.equals("deepseek")) vault.remove("deepseek:" + root);
            }
            default -> throw new IOException("未知模型操作");
        }
        if (!operation.equals("list")) {
            config.add("items", items);
            vault.save("ai-providers:" + root, config);
        }
        var visible = new JsonArray();
        if (find(items, "deepseek") == null) {
            var defaultProvider = builtIn();
            publicProfile(defaultProvider);
            visible.add(defaultProvider);
        }
        for (var item : items) {
            JsonObject row = object(item).deepCopy();
            publicProfile(row);
            visible.add(row);
        }
        return fields("active", text(config, "active", "deepseek"), "items", visible);
    }

    JsonObject current() throws IOException {
        var config = profile();
        JsonObject provider = find(array(config.get("items")), text(config, "active", "deepseek"));
        return provider == null ? builtIn() : provider;
    }

    JsonObject forTest(JsonObject input) throws IOException {
        var provider = input.deepCopy();
        URI endpoint = validate(provider);
        String proposed = text(input, "key", "");
        if (proposed.isEmpty()) {
            JsonObject old = find(array(profile().get("items")), text(input, "id", ""));
            if (old != null) {
                if (!endpoint.toString().equals(required(old, "endpoint"))) throw new IOException("API 地址已变更，请重新填写 Key 后测试");
                proposed = text(old, "key", "");
            } else if (DEEPSEEK.equals(endpoint.toString()) && "deepseek".equals(text(input, "id", ""))) proposed = key();
        }
        validateKey(proposed, endpoint);
        provider.addProperty("key", proposed);
        return provider;
    }

    JsonObject options(JsonObject payload) throws IOException {
        Path path = GameFiles.target(root, "ai-options.json");
        if (payload.has("automatic") && payload.get("automatic").isJsonPrimitive() && payload.getAsJsonPrimitive("automatic").isBoolean()) {
            JsonFiles.write(path, fields("automatic", payload.get("automatic")));
        }
        try { if (Files.isRegularFile(path)) return object(JsonFiles.read(path)); }
        catch (IOException | JsonParseException ignored) { /* Default to the original preference. */ }
        return fields("automatic", true);
    }

    JsonObject legacyKey(String action, JsonObject payload) throws IOException {
        switch (action) {
            case "ai_key_save" -> {
                String key = required(payload, "key").strip();
                if (key.length() < 8 || key.length() > 512 || key.codePoints().anyMatch(Character::isWhitespace)) throw new IOException("请输入有效的 DeepSeek API Key");
                vault.save("deepseek:" + root, fields("key", key));
            }
            case "ai_key_remove" -> vault.remove("deepseek:" + root);
            case "ai_key_status" -> { }
            default -> throw new IOException("密钥操作无效");
        }
        return fields("configured", !key().isEmpty());
    }

    private JsonObject builtIn() throws IOException {
        return fields("id", "deepseek", "name", "DeepSeek", "endpoint", DEEPSEEK, "model", "deepseek-flash", "key", key());
    }

    private String key() {
        try { return text(vault.load("deepseek:" + root), "key", ""); }
        catch (IOException missing) { return ""; }
    }

    private JsonObject profile() {
        try { return vault.load("ai-providers:" + root); }
        catch (IOException missing) { return fields("active", "deepseek", "items", new JsonArray()); }
    }

    private static JsonObject find(JsonArray items, String id) {
        return items.asList().stream().map(LaunchManifest::object).filter(item -> id.equals(text(item, "id", null))).findFirst().orElse(null);
    }

    private static void publicProfile(JsonObject item) throws IOException {
        String key = text(item, "key", "");
        item.remove("key");
        item.addProperty("configured", !key.isEmpty() || local(validate(item)));
    }

    static URI validate(JsonObject value) throws IOException {
        URI url;
        try { url = URI.create(required(value, "endpoint")); }
        catch (IllegalArgumentException invalid) { throw new IOException("请输入有效的 API 地址"); }
        if (!("https".equals(url.getScheme()) || local(url)) || url.getHost() == null || url.getRawUserInfo() != null
            || url.getRawQuery() != null || url.getRawFragment() != null) throw new IOException("远程 API 地址须使用 HTTPS");
        for (String field : Set.of("name", "model")) {
            String name = required(value, field);
            if (name.isBlank() || name.getBytes(StandardCharsets.UTF_8).length > 200) throw new IOException("服务名称或模型名称无效");
        }
        return url;
    }

    private static boolean local(URI url) {
        return "http".equals(url.getScheme()) && url.getHost() != null && Set.of("localhost", "127.0.0.1", "[::1]").contains(url.getHost());
    }

    static void validateKey(String key, URI endpoint) throws IOException {
        if (key.isEmpty() && !local(endpoint)) throw new IOException("请先填写 API Key");
        if (key.length() > 4096 || key.codePoints().anyMatch(cp -> Character.isWhitespace(cp) || Character.isISOControl(cp))) throw new IOException("API Key 格式无效");
    }

    static JsonObject fields(Object... values) {
        var result = new JsonObject();
        for (int i = 0; i < values.length; i += 2) result.add((String) values[i], JsonFiles.JSON.toJsonTree(values[i + 1]));
        return result;
    }
}
