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
