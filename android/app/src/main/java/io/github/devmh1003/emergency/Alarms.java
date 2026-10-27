package io.github.devmh1003.emergency;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

/**
 * 알림 채널과 알림 만들기.
 * 1급(긴급): "경보" 채널. 경보음을 알람 소리로 반복하고(확인할 때까지), 잠금 화면 위에 전체 화면 경보를 띄운다.
 * 그 밖(2급·해제·테스트 알림): "알림" 채널. 보통 알림.
 */
final class Alarms {
    static final String CHANNEL_ALARM = "alarm-v1";
    static final String CHANNEL_NOTICE = "notice-v1";
    static final int ID_ALARM = 1001;
    static final long[] VIBRATION = {0, 600, 300, 600, 300, 600};

    private Alarms() {}

    static Uri sirenUri(Context ctx) {
        return Uri.parse("android.resource://" + ctx.getPackageName() + "/" + R.raw.siren);
    }

    static void createChannels(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        AudioAttributes alarmAudio = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        NotificationChannel alarm = new NotificationChannel(CHANNEL_ALARM, "1급 비상 경보", NotificationManager.IMPORTANCE_HIGH);
        alarm.setDescription("지진·전쟁·대형재난 같은 1급 비상. 경보음과 전체 화면 경보");
        alarm.setSound(sirenUri(ctx), alarmAudio);
        alarm.enableVibration(true);
        alarm.setVibrationPattern(VIBRATION);
        alarm.setBypassDnd(true);
        alarm.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(alarm);

        NotificationChannel notice = new NotificationChannel(CHANNEL_NOTICE, "2급 비상·알림", NotificationManager.IMPORTANCE_HIGH);
        notice.setDescription("준위험 상황(2급), 비상 해제, 테스트 알림");
        notice.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(notice);
    }

    /** 1급: 전체 화면 경보. 화면이 꺼져 있거나 잠겨 있으면 바로 경보 화면이 뜨고, 사용 중이면 위쪽 알림이 뜨며 경보음이 계속 울린다. */
    static void showUrgent(Context ctx, String title, String body, String ack, boolean test) {
        createChannels(ctx);
        Intent alarm = AlarmActivity.intent(ctx, title, body, ack, test);
        PendingIntent full = PendingIntent.getActivity(ctx, 1, alarm,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_ALARM)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setSound(sirenUri(ctx))
                .setVibrate(VIBRATION)
                .setFullScreenIntent(full, true)
                .setContentIntent(full)
                .setOngoing(true)
                .setAutoCancel(true)
                .build();
        n.flags |= Notification.FLAG_INSISTENT; // 확인할 때까지 소리 반복
        ctx.getSystemService(NotificationManager.class).notify(ID_ALARM, n);
    }

    /** 2급·해제·테스트 알림: 보통 알림. 누르면 앱이 열린다. */
    static void showNotice(Context ctx, String title, String body, String ack) {
        createChannels(ctx);
        Intent open = MainActivity.intent(ctx, ack);
        PendingIntent pi = PendingIntent.getActivity(ctx, 2, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_NOTICE)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        ctx.getSystemService(NotificationManager.class).notify((int) (System.currentTimeMillis() % 100000), n);
    }

    static void cancelUrgent(Context ctx) {
        ctx.getSystemService(NotificationManager.class).cancel(ID_ALARM);
    }

    /** 안드로이드 14부터 전체 화면 경보는 사용자가 따로 허용해야 한다. */
    static boolean canFullScreen(Context ctx) {
        if (Build.VERSION.SDK_INT < 34) return true;
        return ctx.getSystemService(NotificationManager.class).canUseFullScreenIntent();
    }
}
