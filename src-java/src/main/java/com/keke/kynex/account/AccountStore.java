package com.keke.kynex.account;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.Strictness;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.function.Consumer;

public final class AccountStore {
    private static final Gson JSON = new GsonBuilder().setStrictness(Strictness.STRICT)
        .disableHtmlEscaping().setPrettyPrinting().create();

    private final Path file;

    public AccountStore(Path dataRoot) {
        file = dataRoot.toAbsolutePath().normalize().resolve("accounts.json");
    }

    public synchronized JsonArray list() throws IOException {
        try (var input = Files.newBufferedReader(file)) {
            JsonElement accounts = JSON.fromJson(input, JsonElement.class);
            if (accounts == null || !accounts.isJsonArray()) throw new IOException("账号数据损坏");
            return accounts.getAsJsonArray();
        } catch (NoSuchFileException missing) {
            return new JsonArray();
        } catch (JsonParseException invalid) {
            throw new IOException("账号数据损坏", invalid);
        }
    }

    public synchronized JsonObject loginOffline(String name) throws IOException {
        OfflineIdentity identity = OfflineIdentity.fromName(name);
        var account = new JsonObject();
        account.addProperty("id", identity.accountId());
        account.addProperty("uuid", identity.uuid());
        account.addProperty("name", identity.name());
        account.addProperty("kind", "offline");
        return save(account);
    }

    public synchronized JsonObject find(String id) throws IOException {
        for (var candidate : list()) {
            if (candidate instanceof JsonObject account && id.equals(com.keke.kynex.core.JsonFiles.text(account, "id", ""))) {
                return account;
            }
        }
        throw new IOException("请先选择账号");
    }

    public synchronized JsonObject save(JsonObject account) throws IOException {
        removeAndSave(account.get("id"), account);
        return account;
    }

    public synchronized void remove(String id) throws IOException {
        removeAndSave(new com.google.gson.JsonPrimitive(id), null);
    }

    private void removeAndSave(JsonElement id, JsonObject replacement) throws IOException {
        update(accounts -> {
            accounts.asList().removeIf(row -> row.isJsonObject() && id.equals(row.getAsJsonObject().get("id")));
            if (replacement != null) accounts.add(replacement);
        });
    }

    private void update(Consumer<JsonArray> mutation) throws IOException {
        Path parent = Files.createDirectories(file.getParent());
        try (var channel = FileChannel.open(parent.resolve("accounts.lock"),
            StandardOpenOption.CREATE, StandardOpenOption.WRITE);
            var lock = channel.lock()) {
            JsonArray accounts = list();
            mutation.accept(accounts);
            write(parent, accounts);
        }
    }

    private void write(Path parent, JsonArray accounts) throws IOException {
        Path temporary = Files.createTempFile(parent, "accounts-", ".tmp");
        try {
            try (var output = Files.newBufferedWriter(temporary)) {
                JSON.toJson(accounts, output);
            }
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }
}
