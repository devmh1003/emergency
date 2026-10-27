package io.github.devmh1003.emergency;

import android.content.Context;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * 알림 서버(Worker)가 보낸 메시지를 받는다. 앱 기기에는 "데이터 메시지"로 오므로 앱이 닫혀 있어도 여기로 온다.
 * data: kind (emergency | end | test | push-test), level (real | alert), title, body, ack
 */
public class PushService extends FirebaseMessagingService {
    static final String PREFS = "family";
    static final String KEY_TOKEN = "fcmToken";

    static String savedToken(Context ctx) {
        return ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_TOKEN, "");
    }

    static void saveToken(Context ctx, String token) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_TOKEN, token).apply();
    }

    @Override
    public void onNewToken(@NonNull String token) {
        saveToken(this, token);
        MainActivity.sendTokenToPage(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> d = message.getData();
        String kind = value(d, "kind", "emergency");
        String level = value(d, "level", "real");
        String title = value(d, "title", "우리 가족 비상연락");
        String body = value(d, "body", "");
        String ack = value(d, "ack", "");

        // 앱 화면이 열려 있으면 사이트가 직접 경보 화면을 띄운다 (두 번 울리지 않게).
        boolean pageHandles = MainActivity.isForeground() && !"push-test".equals(kind);
        if (pageHandles) return;

        boolean urgent = ("emergency".equals(kind) || "test".equals(kind)) && "real".equals(level);
        if (urgent) Alarms.showUrgent(this, title, body, ack, "test".equals(kind));
        else Alarms.showNotice(this, title, body, ack);
    }

    private static String value(Map<String, String> d, String key, String fallback) {
        String v = d.get(key);
        return v == null || v.isEmpty() ? fallback : v;
    }
}
