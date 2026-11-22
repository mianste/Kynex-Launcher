package com.keke.kynex.account;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Pattern;

public record OfflineIdentity(String name, String uuid) {
    private static final Pattern USERNAME = Pattern.compile("[A-Za-z0-9_]{3,16}");

    public static OfflineIdentity fromName(String name) {
        if (name == null || !USERNAME.matcher(name).matches()) {
            throw new IllegalArgumentException("用户名需要 3–16 位字母、数字或下划线");
        }

        var bytes = ("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8);
        String uuid = UUID.nameUUIDFromBytes(bytes).toString().replace("-", "");
        return new OfflineIdentity(name, uuid);
    }

    public String accountId() {
        return "offline-" + uuid;
    }
}
