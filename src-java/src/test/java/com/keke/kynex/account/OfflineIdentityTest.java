package com.keke.kynex.account;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class OfflineIdentityTest {
    @Test
    void preservesExistingOfflineIds() {
        checkId("dfshsd", "offline-4d69167e5d5f3487adf0dfded168a764");
        checkId("Notch", "offline-b50ad385829d3141a2167e7d7539ba7f");
        checkId("Player2", "offline-aed5efd4551b3965bc28ae21aa072a66");
    }

    @Test
    void rejectsUnsupportedNames() {
        for (String name : new String[] {"ab", "Player 2", "玩家二", "12345678901234567"}) {
            assertThrows(IllegalArgumentException.class, () -> OfflineIdentity.fromName(name));
        }
    }

    private static void checkId(String name, String expected) {
        var identity = OfflineIdentity.fromName(name);
        assertEquals(name, identity.name());
        assertEquals(expected, identity.accountId());
    }

    @Test
    void readsAndUpdatesExistingAccountFiles(@TempDir Path directory) throws IOException {
        AccountStore store = new AccountStore(directory);
        assertTrue(store.list().isEmpty());
        Files.writeString(directory.resolve("accounts.json"), """
            [{"id":"microsoft-fixture","name":"Original","kind":"microsoft","skinModel":"Slim","extra":{"keep":true}}]
            """);
        var original = store.list().get(0);
        store.loginOffline("dfshsd");
        var created = store.loginOffline("dfshsd");
        var reopened = new AccountStore(directory).list();
        assertEquals(2, reopened.size());
        assertEquals(original, reopened.get(0));
        assertEquals(created, reopened.get(1));
    }
}
