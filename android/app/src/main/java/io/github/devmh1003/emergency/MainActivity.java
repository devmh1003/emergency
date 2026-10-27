package io.github.devmh1003.emergency;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

/**
 * 사이트(https://devmh1003.github.io/emergency/)를 그대로 연다. 사이트를 고치면 앱에도 바로 반영된다.
 * 사이트는 window.FamilyApp 으로 앱 기능(알림 토큰, 권한 화면)을 쓴다.
 */
public class MainActivity extends Activity {
    static final String SITE = "https://devmh1003.github.io/emergency/";
    private static final String EXTRA_ACK = "ack";
    private static final String PREF_PERMS_SHOWN = "permsShown";
    private static final int REQ_LOCATION = 11;

    private static MainActivity current;
    private static boolean foreground;

    private WebView web;
    private String pendingAck = "";
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;

    static Intent intent(Context ctx, String ack) {
        return new Intent(ctx, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_ACK, ack == null ? "" : ack);
    }

    static boolean isForeground() {
        return foreground;
    }

    /** 새 알림 토큰을 열려 있는 사이트에 알려 준다. */
    static void sendTokenToPage(String token) {
        MainActivity a = current;
        if (a == null || a.web == null) return;
        a.runOnUiThread(() -> a.web.evaluateJavascript(
                "window.familyNativeToken && window.familyNativeToken(" + JSONObject.quote(token) + ")", null));
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        current = this;
        Alarms.createChannels(this);
        takeAck(getIntent());

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // 앱을 보고 있을 때 경보음이 바로 울리게
        s.setUserAgentString(s.getUserAgentString() + " FamilyEmergencyApp/" + BuildConfig.VERSION_NAME);
        web.addJavascriptInterface(new Bridge(), "FamilyApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri.toString().startsWith(SITE)) return false;
                // 전화·문자·지도·다른 사이트는 휴대폰의 앱으로 연다.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    geoOrigin = origin;
                    geoCallback = callback;
                    requestPermissions(new String[] {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                }
            }
        });
        setContentView(web);
        if (saved != null) web.restoreState(saved);
        else web.loadUrl(SITE);

        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> {
            PushService.saveToken(this, token);
            sendTokenToPage(token);
        });

        // 처음 실행하면 권한 화면부터 보여 준다.
        if (!getSharedPreferences(PushService.PREFS, MODE_PRIVATE).getBoolean(PREF_PERMS_SHOWN, false)) {
            getSharedPreferences(PushService.PREFS, MODE_PRIVATE).edit().putBoolean(PREF_PERMS_SHOWN, true).apply();
            startActivity(new Intent(this, PermissionsActivity.class));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        takeAck(intent);
        if (web != null && !pendingAck.isEmpty()) {
            web.evaluateJavascript("window.familyNativeAckPending && window.familyNativeAckPending()", null);
        }
    }

    private void takeAck(Intent intent) {
        String ack = intent == null ? null : intent.getStringExtra(EXTRA_ACK);
        if (ack != null && !ack.isEmpty()) pendingAck = ack;
    }

    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
    }

    @Override
    protected void onPause() {
        foreground = false;
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == REQ_LOCATION && geoCallback != null) {
            boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            geoCallback.invoke(geoOrigin, ok, false);
            geoCallback = null;
        }
    }

    /** 사이트에서 window.FamilyApp.* 로 부르는 함수 */
    public class Bridge {
        @JavascriptInterface
        public String getPushToken() {
            return PushService.savedToken(MainActivity.this);
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        /** 알림·전체 화면·방해 금지·배터리·위치 권한 상태 (JSON) */
        @JavascriptInterface
        public String permissions() {
            return PermissionsActivity.status(MainActivity.this).toString();
        }

        @JavascriptInterface
        public void openPermissions() {
            runOnUiThread(() -> startActivity(new Intent(MainActivity.this, PermissionsActivity.class)));
        }

        /** 앱 경보 화면에서 확인한 경보 (사이트가 같은 경보를 다시 띄우지 않게). 한 번 읽으면 지운다. */
        @JavascriptInterface
        public String takePendingAck() {
            String ack = pendingAck;
            pendingAck = "";
            return ack;
        }

        /** 앱의 전체 화면 경보를 이 휴대폰에서 시험한다. */
        @JavascriptInterface
        public void testAlarm() {
            runOnUiThread(() -> startActivity(AlarmActivity.intent(MainActivity.this,
                    "🔔 앱 경보 화면 시험", "이 휴대폰에서만 울립니다. 가족에게는 알림이 가지 않습니다.", "", true)));
        }
    }
}
