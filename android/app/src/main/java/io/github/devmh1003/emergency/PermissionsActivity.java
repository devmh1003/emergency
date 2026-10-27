package io.github.devmh1003.emergency;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.TypedValue;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * 경보가 제대로 뜨는 데 필요한 권한을 한 화면에서 차례로 받는다.
 * 처음 실행할 때 자동으로 열리고, 사이트의 설정 화면에서 다시 열 수 있다.
 */
public class PermissionsActivity extends Activity {
    private static final int REQ = 21;
    private LinearLayout list;

    static boolean notifications(Context c) {
        if (Build.VERSION.SDK_INT < 33) return c.getSystemService(NotificationManager.class).areNotificationsEnabled();
        return c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean dnd(Context c) {
        return c.getSystemService(NotificationManager.class).isNotificationPolicyAccessGranted();
    }

    static boolean battery(Context c) {
        return c.getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(c.getPackageName());
    }

    static boolean location(Context c) {
        return c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static JSONObject status(Context c) {
        JSONObject o = new JSONObject();
        try {
            o.put("notifications", notifications(c));
            o.put("fullScreen", Alarms.canFullScreen(c));
            o.put("dnd", dnd(c));
            o.put("battery", battery(c));
            o.put("location", location(c));
        } catch (JSONException ignored) { }
        return o;
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Alarms.createChannels(this);
        ScrollView scroll = new ScrollView(this);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        list.setPadding(pad, pad, pad, pad);
        scroll.addView(list);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        draw();
    }

    private void draw() {
        list.removeAllViews();
        list.addView(text("경보 권한 설정", 24, true, Color.BLACK));
        list.addView(text("1급 비상이 오면 화면이 꺼져 있어도 잠금 화면 위에 전체 화면 경보가 뜨고 경보음이 울리도록, 아래 권한을 모두 켜 주세요.", 16, false, Color.DKGRAY));

        item("① 알림", "비상 알림을 받습니다.", notifications(this), () -> {
            if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ);
            else openAppNotifications();
        });
        item("② 전체 화면 알림", "1급 비상 때 잠금 화면 위에 전화 오듯 경보 화면을 띄웁니다. 설정 화면에서 이 앱을 허용하세요.", Alarms.canFullScreen(this), () -> {
            if (Build.VERSION.SDK_INT >= 34) {
                open(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName())));
            }
        });
        item("③ 방해 금지 모드 무시", "방해 금지·무음 모드에서도 1급 경보음이 울립니다. 목록에서 이 앱을 찾아 허용하세요.", dnd(this),
                () -> open(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)));
        item("④ 배터리 최적화 제외", "휴대폰이 앱을 잠재워 경보를 놓치지 않게 합니다.", battery(this),
                () -> open(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()))));
        item("⑤ 위치", "생존신고와 집합장소 거리·방향에 씁니다.", location(this),
                () -> requestPermissions(new String[] {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ));

        list.addView(text("1급 경보 알림 소리·방해 금지 무시는 아래 '경보 채널 설정'에서도 확인할 수 있습니다.", 14, false, Color.GRAY));
        list.addView(button("경보 채널 설정 열기", false, () -> open(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                .putExtra(Settings.EXTRA_CHANNEL_ID, Alarms.CHANNEL_ALARM))));
        list.addView(button("🔔 경보 화면 시험 (이 휴대폰에서만)", false, () -> startActivity(AlarmActivity.intent(this,
                "🔔 앱 경보 화면 시험", "이 휴대폰에서만 울립니다. 가족에게는 알림이 가지 않습니다.", "", true))));
        list.addView(button("완료 — 앱으로 돌아가기", true, this::finish));
    }

    private void item(String title, String desc, boolean on, Runnable action) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(0, dp(16), 0, dp(4));
        row.addView(text(title + (on ? "  ✅ 켜짐" : "  ⚠️ 꺼짐"), 18, true, on ? Color.parseColor("#008817") : Color.parseColor("#b50909")));
        row.addView(text(desc, 15, false, Color.DKGRAY));
        if (!on) row.addView(button("허용하러 가기", false, action));
        list.addView(row);
    }

    private TextView text(String s, int sp, boolean bold, int color) {
        TextView tv = new TextView(this);
        tv.setText(s);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        tv.setTextColor(color);
        if (bold) tv.setTypeface(Typeface.DEFAULT_BOLD);
        tv.setPadding(0, dp(4), 0, dp(4));
        return tv;
    }

    private Button button(String label, boolean primary, Runnable action) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        if (primary) {
            b.setBackgroundColor(Color.parseColor("#1a4480"));
            b.setTextColor(Color.WHITE);
        }
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        b.setLayoutParams(lp);
        b.setOnClickListener(v -> action.run());
        return b;
    }

    private void openAppNotifications() {
        open(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
    }

    private void open(Intent intent) {
        try {
            startActivity(intent);
        } catch (Exception e) {
            open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        draw();
    }
}
