package com.keke.kynex.core;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import org.bouncycastle.crypto.digests.Blake2bDigest;

final class ReleaseSignature {
    private static final String COMMENT = "trusted comment: ";
    private final PublicKey key;
    private final byte[] identity;

    ReleaseSignature(String encoded) throws IOException {
        try {
            String[] lines = decode(encoded).split("\\R");
            byte[] data = Base64.getDecoder().decode(lines[1]);
            if (data.length != 42 || data[0] != 'E' || data[1] != 'd') throw new IOException("更新公钥无效");
            identity = Arrays.copyOfRange(data, 2, 10);
            byte[] x509 = Arrays.copyOf(HexFormat.of().parseHex("302a300506032b6570032100"), 44);
            System.arraycopy(data, 10, x509, 12, 32);
            key = KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(x509));
        } catch (IllegalArgumentException | IndexOutOfBoundsException | GeneralSecurityException invalid) {
            throw new IOException("无法读取更新公钥");
        }
    }

    String verify(InputStream stream, String encoded) throws IOException {
        if (encoded.length() > 16_384) throw new IOException("更新签名过大");
        try {
            String[] rows = decode(encoded).split("\\R", -1);
            if (rows.length < 4 || !rows[2].startsWith(COMMENT)) throw new IOException("更新签名格式无效");
            byte[] signature = Base64.getDecoder().decode(rows[1]);
            byte[] commentSignature = Base64.getDecoder().decode(rows[3]);
            if (signature.length != 74 || signature[0] != 'E' || signature[1] != 'D' || commentSignature.length != 64
                || !Arrays.equals(signature, 2, 10, identity, 0, 8)) throw new IOException("更新签名使用了不受支持的签名算法或公钥");
            var hash = new Blake2bDigest(512);
            byte[] buffer = new byte[64 * 1024];
            for (int length; (length = stream.read(buffer)) >= 0;) hash.update(buffer, 0, length);
            byte[] digest = new byte[64];
            hash.doFinal(digest, 0);
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(key);
            verifier.update(digest);
            if (!verifier.verify(signature, 10, 64)) throw new IOException("更新文件签名校验失败");
            verifier.initVerify(key);
            verifier.update(signature, 10, 64);
            String comment = rows[2].substring(COMMENT.length());
            verifier.update(comment.getBytes(StandardCharsets.UTF_8));
            if (!verifier.verify(commentSignature)) throw new IOException("更新说明签名校验失败");
            return comment;
        } catch (IllegalArgumentException | GeneralSecurityException invalid) { throw new IOException("更新签名无效"); }
    }

    private static String decode(String base64) {
        return new String(Base64.getDecoder().decode(base64.strip()), StandardCharsets.UTF_8);
    }
}
