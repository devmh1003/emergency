package io.github.devmh1003.emergency;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * 잠금 화면 위에 뜨는 1급 비상 전체 화면 경보. 확인을 누를 때까지 경보음(알람 소리)과 진동이 반복된다.
 * 테스트 알람은 1분 뒤 소리가 저절로 멈춘다.
 */
public class AlarmActivity extends Activity {
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_BODY = "body";
    private static final String EXTRA_ACK = "ack";
    private static final String EXTRA_TEST = "test";

    private MediaPlayer player;
    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());

    static Intent intent(Context ctx, String title, String body, String ack, boolean test) {
        return new Intent(ctx, AlarmActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_BODY, body)
                .putExtra(EXTRA_ACK, ack)
                .putExtra(EXTRA_TEST, test);
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        render(getIntent());
        // 알림의 반복 소리는 끄고, 이 화면이 경보음을 낸다.
        Alarms.cancelUrgent(this);
        startSound(getIntent().getBooleanExtra(EXTRA_TEST, false));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        render(intent);
        Alarms.cancelUrgent(this);
        startSound(intent.getBooleanExtra(EXTRA_TEST, false));
    }

    private void render(Intent in) {
        boolean test = in.getBooleanExtra(EXTRA_TEST, false);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        int pad = dp(28);
        box.setPadding(pad, pad, pad, pad);
        box.setBackgroundColor(test ? Color.parseColor("#162e51") : Color.parseColor("#33190a"));

        box.addView(text(test ? "TEST · 테스트 알람" : "EMERGENCY · 1급 비상", 14, Color.parseColor("#ffbe2e"), true));
        box.addView(text(test ? "🔔" : "🚨", 72, Color.WHITE, false));
        box.addView(text(in.getStringExtra(EXTRA_TITLE), 30, Color.WHITE, true));
        String body = in.getStringExtra(EXTRA_BODY);
        if (body != null && !body.isEmpty()) box.addView(text(body, 19, Color.WHITE, false));
        box.addView(text(test ? "실제 상황이 아닙니다. 경보가 잘 울리는지 확인하는 훈련입니다."
                : "지금 비상 상황입니다. 생존신고를 하고 집합장소로 이동하세요.", 17, Color.parseColor("#dfe1e2"), false));

        Button ok = new Button(this);
        ok.setText(test ? "확인 — 잘 받았어요" : "확인 — 생존신고 하러 가기");
        ok.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        ok.setAllCaps(false);
        ok.setTextColor(Color.WHITE);
        ok.setBackgroundColor(Color.parseColor("#008817"));
        ok.setPadding(dp(16), dp(18), dp(16), dp(18));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(28);
        ok.setLayoutParams(lp);
        ok.setOnClickListener(v -> confirm());
        box.addView(ok);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(test ? Color.parseColor("#162e51") : Color.parseColor("#33190a"));
        scroll.addView(box, new ScrollView.LayoutParams(ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.MATCH_PARENT));
        setContentView(scroll);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView tv = new TextView(this);
        tv.setText(s == null ? "" : s);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        tv.setTextColor(color);
        tv.setGravity(Gravity.CENTER);
        if (bold) tv.setTypeface(Typeface.DEFAULT_BOLD);
        tv.setPadding(0, dp(8), 0, dp(8));
        return tv;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void startSound(boolean test) {
        stopSound();
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setDataSource(this, Alarms.sirenUri(this));
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            player = null;
        }
        vibrator = getSystemService(Vibrator.class);
        if (vibrator != null) vibrator.vibrate(VibrationEffect.createWaveform(Alarms.VIBRATION, 0));
        // 테스트는 1분, 실제 경보는 10분 뒤 소리를 멈춘다 (화면은 그대로 남는다).
        handler.postDelayed(this::stopSound, test ? 60_000 : 600_000);
    }

    private void stopSound() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) { }
            player.release();
            player = null;
        }
        if (vibrator != null) vibrator.cancel();
    }

    private void confirm() {
        stopSound();
        Alarms.cancelUrgent(this);
        // 잠겨 있으면 잠금을 풀어 달라고 한 뒤 앱을 연다.
        KeyguardManager km = getSystemService(KeyguardManager.class);
        Intent open = MainActivity.intent(this, getIntent().getStringExtra(EXTRA_ACK));
        if (km != null && km.isKeyguardLocked()) {
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override public void onDismissSucceeded() { startActivity(open); finish(); }
                @Override public void onDismissCancelled() { finish(); }
                @Override public void onDismissError() { finish(); }
            });
        } else {
            startActivity(open);
            finish();
        }
    }

    @Override
    public void onBackPressed() {
        confirm();
    }

    @Override
    protected void onDestroy() {
        stopSound();
        super.onDestroy();
    }
}
