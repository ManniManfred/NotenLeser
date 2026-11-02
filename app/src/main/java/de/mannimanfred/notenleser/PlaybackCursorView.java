package de.mannimanfred.notenleser;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;

/** Draws the playback position over the score: a tinted current measure and a cursor line. Ignores touches. */
final class PlaybackCursorView extends View {
    private final Paint measurePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint cursorPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF measure = new RectF();
    private float cursorX;
    private boolean shown;

    PlaybackCursorView(Context context) {
        super(context);
        measurePaint.setColor(Color.argb(40, 20, 112, 196));
        cursorPaint.setColor(Color.argb(190, 20, 112, 196));
        setClickable(false); setFocusable(false);
    }

    /** Positions in view pixels. */
    void show(float measureLeft, float measureRight, float x, float top, float bottom) {
        measure.set(measureLeft, top, measureRight, bottom);
        cursorX = x; shown = true;
        invalidate();
    }

    void clear() {
        if (!shown) return;
        shown = false;
        invalidate();
    }

    @Override protected void onDraw(Canvas canvas) {
        if (!shown) return;
        canvas.drawRect(measure, measurePaint);
        float half = Math.max(1.5f, getResources().getDisplayMetrics().density * 1.5f);
        canvas.drawRect(cursorX - half, measure.top, cursorX + half, measure.bottom, cursorPaint);
    }
}
