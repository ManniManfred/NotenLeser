package de.mannimanfred.notenleser;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.View;

import java.util.Locale;

/**
 * Shows what the camera gesture detector sees: the brightness grid as the player sees it (mirrored),
 * changing cells in red, the start and current motion centroid and how far the motion has travelled.
 */
final class GestureDebugView extends View {

    private static final int ACCENT = Color.rgb(196, 152, 72);
    private static final long GESTURE_SHOWN_MS = 1500;

    private CameraGestureDetector.DebugFrame frame;
    private String lastGesture;
    private long lastGestureTime;
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF rect = new RectF();
    private final float density;

    GestureDebugView(Context context) {
        super(context);
        density = context.getResources().getDisplayMetrics().density;
        text.setTextSize(11 * density);
        text.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        line.setStyle(Paint.Style.STROKE);
    }

    void show(CameraGestureDetector.DebugFrame newFrame) {
        frame = newFrame;
        if (newFrame.swipe != 0) {
            lastGesture = newFrame.swipe > 0 ? "← nächstes System" : "→ vorheriges System";
            lastGestureTime = SystemClock.uptimeMillis();
        }
        invalidate();
    }

    void clear() { frame = null; lastGesture = null; invalidate(); }

    @Override protected void onDraw(Canvas canvas) {
        float pad = 8 * density, lineHeight = 15 * density;
        fill.setColor(Color.argb(228, 24, 28, 34));
        rect.set(0, 0, getWidth(), getHeight());
        canvas.drawRoundRect(rect, 14 * density, 14 * density, fill);
        text.setColor(Color.WHITE);
        if (frame == null) {
            canvas.drawText("Kamera-Erkennung startet …", pad, pad + lineHeight, text);
            return;
        }
        // The grid keeps its aspect ratio inside the space above the three text lines.
        float areaWidth = getWidth() - 2 * pad, areaHeight = getHeight() - 2 * pad - 3 * lineHeight;
        float cell = Math.min(areaWidth / frame.width, areaHeight / frame.height);
        float left = pad + (areaWidth - cell * frame.width) / 2f, top = pad;
        float gridWidth = cell * frame.width, gridHeight = cell * frame.height;
        for (int y = 0; y < frame.height; y++) {
            for (int x = 0; x < frame.width; x++) {
                int i = y * frame.width + x;
                int l = Math.max(0, Math.min(255, Math.round(frame.luma[i])));
                fill.setColor(Color.rgb(l, l, l));
                canvas.drawRect(left + x * cell, top + y * cell, left + (x + 1) * cell, top + (y + 1) * cell, fill);
                if (frame.change[i] >= CameraGestureDetector.CELL_THRESHOLD) {
                    fill.setColor(Color.argb(Math.min(220, 90 + Math.round(frame.change[i] * 2)), 230, 40, 40));
                    canvas.drawRect(left + x * cell, top + y * cell, left + (x + 1) * cell, top + (y + 1) * cell, fill);
                }
            }
        }
        line.setStrokeWidth(1.5f * density);
        if (!Float.isNaN(frame.startX)) {
            float sx = left + frame.startX * gridWidth, sy = top + frame.startY * gridHeight;
            // Dashed limits show how far the centroid has to move from its start.
            line.setColor(Color.argb(160, 255, 255, 255));
            line.setPathEffect(new android.graphics.DashPathEffect(new float[]{4 * density, 3 * density}, 0));
            for (int side = -1; side <= 1; side += 2) {
                float limit = sx + side * frame.minTravel * gridWidth;
                if (limit >= left && limit <= left + gridWidth) canvas.drawLine(limit, top, limit, top + gridHeight, line);
            }
            line.setPathEffect(null);
            if (!Float.isNaN(frame.x)) {
                line.setColor(ACCENT);
                canvas.drawLine(sx, sy, left + frame.x * gridWidth, top + frame.y * gridHeight, line);
            }
            line.setColor(Color.WHITE);
            canvas.drawCircle(sx, sy, 4 * density, line);
        }
        if (!Float.isNaN(frame.x)) {
            fill.setColor(ACCENT);
            canvas.drawCircle(left + frame.x * gridWidth, top + frame.y * gridHeight, 5 * density, fill);
        }
        line.setColor(Color.argb(90, 255, 255, 255)); line.setStrokeWidth(density);
        canvas.drawRect(left, top, left + gridWidth, top + gridHeight, line);

        float textY = top + gridHeight + lineHeight;
        boolean moving = frame.share >= frame.minMoving;
        text.setColor(moving ? Color.WHITE : Color.rgb(150, 158, 168));
        canvas.drawText(String.format(Locale.GERMANY, "Bewegung %.1f %% (ab %.0f %%)", frame.share * 100, frame.minMoving * 100), pad, textY, text);
        text.setColor(frame.tracking ? Color.WHITE : Color.rgb(150, 158, 168));
        String direction = frame.travel < 0 ? "←" : frame.travel > 0 ? "→" : "";
        canvas.drawText(String.format(Locale.GERMANY, "Weg %s %.0f %% von %.0f %%", direction,
                Math.abs(frame.travel) * 100, frame.minTravel * 100), pad, textY + lineHeight, text);
        boolean recent = lastGesture != null && SystemClock.uptimeMillis() - lastGestureTime < GESTURE_SHOWN_MS;
        text.setColor(recent ? ACCENT : Color.rgb(150, 158, 168));
        canvas.drawText(recent ? lastGesture : (frame.tracking ? "Bewegung wird verfolgt" : "Keine Geste"), pad, textY + 2 * lineHeight, text);
    }
}
