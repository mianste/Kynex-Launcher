package com.keke.kynex.core;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertThrows;

class ReleaseSignatureTest {
    // Public prehashed interoperability vector from the Minisign verifier.
    private static final String PUBLIC = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
    private static final String SIGNED = "untrusted comment: test\n"
        + "RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\n"
        + "trusted comment: timestamp:1556193335\tfile:test\n"
        + "y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==";

    @Test void acceptsMinisignPrehashedVectorAndRejectsChangedPayloadOrComment() throws Exception {
        var verifier = new ReleaseSignature(encoded("untrusted comment: test\n" + PUBLIC));
        verifier.verify(bytes("test"), encoded(SIGNED));
        assertThrows(IOException.class, () -> verifier.verify(bytes("Test"), encoded(SIGNED)));
        assertThrows(IOException.class, () -> verifier.verify(bytes("test"), encoded(SIGNED.replace("file:test", "file:renamed"))));
    }

    private static ByteArrayInputStream bytes(String text) { return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)); }
    private static String encoded(String text) { return Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8)); }
}
