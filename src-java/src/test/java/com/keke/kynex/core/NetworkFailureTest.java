package com.keke.kynex.core;

import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class NetworkFailureTest {
    @Test void retriesOnlyDnsFailuresBeforeAnyRequestWasSent() throws Exception {
        var calls = new AtomicInteger();
        assertEquals("ok", NetworkFailure.retryDns(() -> {
            if (calls.incrementAndGet() == 1) throw new UnknownHostException("account.test.invalid");
            return "ok";
        }));
        assertEquals(2, calls.get());
        calls.set(0);
        assertThrows(SocketTimeoutException.class, () -> NetworkFailure.retryDns(() -> {
            calls.incrementAndGet();
            throw new SocketTimeoutException();
        }));
        assertEquals(1, calls.get());
    }

    @Test void translatesWrappedHostErrorsAndPreservesOtherErrors() {
        assertTrue(NetworkFailure.userMessage(new IOException("request failed", new UnknownHostException("host"))).contains("DNS"));
        assertEquals("游戏文件缺失", NetworkFailure.userMessage(new IOException("游戏文件缺失")));
    }
}
