package com.keke.kynex.core;

import java.io.IOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import javax.net.ssl.SSLException;

final class NetworkFailure {
    private NetworkFailure() {}

    @FunctionalInterface
    interface Request<T> { T run() throws IOException; }

    static <T> T retryDns(Request<T> request) throws IOException {
        try {
            return request.run();
        } catch (UnknownHostException first) {
            // DNS failed before a connection could send credentials. Do not
            // replay timeouts/HTTP failures, which may have consumed a token.
            try {
                // Allow the bundled JDK's ten-second negative DNS cache to expire.
                Thread.sleep(11000);
            } catch (InterruptedException cancelled) {
                Thread.currentThread().interrupt();
                throw new java.io.InterruptedIOException("账号验证已取消");
            }
            try {
                return request.run();
            } catch (IOException last) {
                last.addSuppressed(first);
                throw last;
            }
        }
    }

    static String userMessage(Exception error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof UnknownHostException)
                return "无法解析服务器域名（DNS），请检查网络或代理后重试。";
            if (cause instanceof NoRouteToHostException)
                return "当前网络无法连接到服务器，请检查网络、代理或防火墙后重试。";
            if (cause instanceof SocketTimeoutException)
                return "连接服务器超时，请检查网络后重试。";
            if (cause instanceof ConnectException)
                return "无法连接到服务器，请检查网络或代理后重试。";
        }
        return error.getMessage() == null ? "桌面操作失败" : error.getMessage();
    }

    static String describe(IOException error) {
        return switch (error) {
            case GameDownloads.HttpError http when http.status == 429 -> "请求过于频繁（HTTP 429）";
            case GameDownloads.HttpError http when http.status == 401 || http.status == 403 ->
                "来源拒绝了请求（HTTP " + http.status + "）";
            case GameDownloads.HttpError http -> "来源返回 HTTP " + http.status;
            case SocketTimeoutException ignored -> "等待来源响应超时";
            case UnknownHostException ignored -> "无法解析来源域名";
            case SSLException ignored -> "HTTPS 握手失败";
            case ConnectException ignored -> "无法建立连接";
            case NoRouteToHostException ignored -> "当前网络无法到达来源";
            case SocketException ignored -> "连接中断";
            default -> error.getMessage() == null ? "来源连接失败" : error.getMessage();
        };
    }
}
