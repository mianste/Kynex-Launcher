package com.keke.kynex.core;

import com.google.gson.JsonObject;
import com.keke.kynex.account.AccountStore;
import com.keke.kynex.account.CredentialVault;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

final class MicrosoftLoginTest {
    @Test
    void launchesWithAnUnexpiredGameTokenWithoutRequiringTheNetwork(@TempDir Path root) throws Exception {
        var vault = new CredentialVault(new MemoryCredentials());
        var secret = json("{\"minecraftToken\":\"cached-token\",\"refresh\":\"refresh-token\"}");
        secret.addProperty("minecraftExpiresAt", java.time.Instant.now().getEpochSecond() + 3600);
        vault.save("account", secret);
        var calls = new AtomicInteger();
        var login = new MicrosoftLogin(new AccountStore(root), vault, (url, body, mime, bearer) -> {
            calls.incrementAndGet();
            throw new java.net.UnknownHostException("account.test.invalid");
        }, System::nanoTime);
        var account = json("{\"id\":\"account\",\"kind\":\"microsoft\"}");
        assertEquals("cached-token", login.session(account).token());
        assertEquals(0, calls.get());
        secret.addProperty("minecraftExpiresAt", java.time.Instant.now().getEpochSecond() + 20);
        vault.save("account", secret);
        assertThrows(java.net.UnknownHostException.class, () -> login.session(account));
        assertEquals(2, calls.get());
        assertEquals(secret, vault.load("account"));
    }

    @Test
    void preservesLegacyWindowsCredentialsAndAnUninterruptedExistingSession() throws Exception {
        var backing = new MemoryCredentials();
        var vault = new CredentialVault(backing);
        backing.write("legacy", "{\"refresh\":\"中文\"}".getBytes(StandardCharsets.UTF_16LE));
        assertEquals("中文", vault.load("legacy").get("refresh").getAsString());
        var old = json("{\"refresh\":\"old\"}");
        vault.save("legacy", old);
        var next = new JsonObject();
        next.addProperty("refresh", "新数据".repeat(1800));
        backing.failWrite = backing.writes + 2;
        assertThrows(IOException.class, () -> vault.save("legacy", next));
        assertEquals(old, vault.load("legacy"));
        backing.failWrite = 0;
        vault.save("legacy", next);
        assertEquals(next, vault.load("legacy"));
        assertTrue(backing.entries.size() > 2);
        vault.remove("legacy");
        assertTrue(backing.entries.isEmpty());
    }

    @Test
    void preservesExternalRoleSelectionAndHonorsThatRoleDuringRefresh(@TempDir Path root) throws Exception {
        var backing = new MemoryCredentials();
        var accounts = new AccountStore(root);
        String first = "1234567890abcdef1234567890abcdef";
        String selected = "fedcba0987654321fedcba0987654321";
        var login = new ExternalLogin(accounts, new CredentialVault(backing), (url, body, mime, bearer) -> {
            assertTrue(url.startsWith("https://account.test.invalid/"));
            if (url.endsWith("/authenticate")) {
                return reply(200, """
                    {"accessToken":"test-access","clientToken":"test-client","availableProfiles":[
                    {"id":"%s","name":"First"},{"id":"%s","name":"Selected"}]}
                    """.formatted(first, selected));
            }
            if (url.endsWith("/refresh")) {
                assertEquals(selected, json(body).getAsJsonObject("selectedProfile").get("id").getAsString());
                return reply(200, """
                    {"accessToken":"fresh-access","clientToken":"test-client","selectedProfile":{"id":"%s","name":"Selected"}}
                    """.formatted(selected));
            }
            return reply(404, "{}");
        });
        var request = json("{\"server\":\"https://account.test.invalid/\",\"email\":\"example\",\"password\":\"test-password\"}");
        assertEquals(2, login.login(request).getAsJsonArray("profiles").size());
        assertTrue(accounts.list().isEmpty());
        request.addProperty("profile", selected);
        var account = login.login(request);
        assertEquals(selected, account.get("uuid").getAsString());
        assertEquals("fresh-access", login.session(account).token());
        assertFalse(Files.readString(root.resolve("accounts.json")).contains("fresh-access"));
    }

    @Test
    void honorsDevicePollingAndStoresOnlyTheAccountProfileOutsideTheVault(@TempDir Path root) throws Exception {
        var ticks = new AtomicLong();
        var requests = new AtomicInteger();
        var backing = new MemoryCredentials();
        var accounts = new AccountStore(root);
        var login = new MicrosoftLogin(accounts, new CredentialVault(backing), (url, body, mime, bearer) -> {
            requests.incrementAndGet();
            if (url.endsWith("/devicecode")) {
                return reply(200, """
                    {"device_code":"device-fixture","user_code":"LINK-TST","verification_uri":"https://www.microsoft.com/link",
                     "interval":5,"expires_in":900}
                    """);
            }
            if (url.endsWith("/token")) return body.contains("device_code=") && requests.get() == 2
                ? reply(400, "{\"error\":\"slow_down\"}")
                : reply(200, "{\"access_token\":\"oauth-fixture\",\"refresh_token\":\"private-refresh-fixture\"}");
            if (url.endsWith("/authenticate") || url.endsWith("/authorize")) {
                return reply(200, "{\"Token\":\"xbox-fixture\",\"DisplayClaims\":{\"xui\":[{\"uhs\":\"42\"}]}}");
            }
            if (url.endsWith("/login_with_xbox")) return reply(200, "{\"access_token\":\"private-game-token\",\"expires_in\":80}");
            if (url.endsWith("/mcstore")) return reply(200, "{\"items\":[]}");
            assertEquals("private-game-token", bearer);
            return reply(200, "{\"id\":\"1234567890abcdef1234567890abcdef\",\"name\":\"KXL_Test\"}");
        }, ticks::get);
        String flow = login.start().get("flowId").getAsString();
        assertEquals("pending", login.poll(flow).get("status").getAsString());
        assertEquals(1, requests.get());
        ticks.set(Duration.ofSeconds(5).toNanos());
        assertEquals(10, login.poll(flow).get("retryAfter").getAsInt());
        ticks.set(Duration.ofSeconds(15).toNanos());
        JsonObject result = login.poll(flow);
        assertEquals("success", result.get("status").getAsString());
        assertFalse(result.toString().contains("private"));
        String account = Files.readString(root.resolve("accounts.json"));
        assertFalse(account.contains("private"));
        assertTrue(account.contains("KXL_Test"));
        assertEquals("private-game-token", login.session(result.getAsJsonObject("account")).token());
        login.remove(result.getAsJsonObject("account").get("id").getAsString());
        assertTrue(backing.entries.isEmpty());
        assertTrue(accounts.list().isEmpty());
    }

    private static MicrosoftLogin.Response reply(int code, String json) { return new MicrosoftLogin.Response(code, json(json)); }
    private static JsonObject json(String value) { return JsonFiles.JSON.fromJson(value, JsonObject.class); }

    private static final class MemoryCredentials implements CredentialVault.Store {
        final HashMap<String, byte[]> entries = new HashMap<>();
        int writes;
        int failWrite;

        @Override public byte[] read(String key) {
            byte[] value = entries.get(key);
            return value == null ? null : value.clone();
        }

        @Override public void write(String key, byte[] value) throws IOException {
            if (++writes == failWrite) throw new IOException("store failure");
            entries.put(key, value.clone());
        }

        @Override public void remove(String key) { entries.remove(key); }
    }
}
