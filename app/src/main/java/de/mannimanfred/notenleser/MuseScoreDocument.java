package de.mannimanfred.notenleser;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;

import java.io.IOException;

/** MuseScore scores (.mscz/.mscx) engraved with the bundled Leland music font. */
final class MuseScoreDocument implements ScoreDocument {
    private static Typeface musicFont;
    private final ScoreEngraver engraver;
    private final MusicModel.Score score;

    MuseScoreDocument(Context context, byte[] data) throws IOException {
        synchronized (MuseScoreDocument.class) {
            if (musicFont == null) musicFont = Typeface.createFromAsset(context.getAssets(), "fonts/Leland.otf");
        }
        score = MuseScoreReader.read(data);
        if (score.measures.isEmpty()) throw new IOException("Die MuseScore-Datei enthält keine Takte");
        engraver = new ScoreEngraver(score, new CanvasPainter(null, 1f));
    }

    @Override public int getPageCount() { return engraver.pageCount(); }

    @Override public float pageAspect(int page) { return engraver.pageHeight / engraver.pageWidth; }

    @Override public Bitmap renderPage(int page, int width) {
        int height = Math.max(1, Math.round(width * engraver.pageHeight / engraver.pageWidth));
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        bitmap.eraseColor(Color.WHITE);
        engraver.drawPage(new CanvasPainter(new Canvas(bitmap), width / engraver.pageWidth), page);
        return bitmap;
    }

    @Override public float[] systemRatios(int page) { return engraver.systemRatios(page); }

    @Override public float[] staffRatios(int page) { return engraver.staffRatios(page); }

    @Override public void close() { }

    MusicModel.Score score() { return score; }

    /** See {@link ScoreEngraver#cursorAt}. */
    float[] cursorAt(int tick) { return engraver.cursorAt(tick); }

    int systemStartTick(int page, int system) { return engraver.systemStartTick(page, system); }

    /** See {@link ScoreEngraver#measureAt}. */
    int measureAt(int page, float x, float y) { return engraver.measureAt(page, x, y); }

    /** See {@link ScoreEngraver#measureBoxes}. */
    java.util.List<float[]> measureBoxes(int page, int first, int last) { return engraver.measureBoxes(page, first, last); }

    /** Draws in staff spaces scaled by k pixels per staff space. */
    private static final class CanvasPainter implements ScorePainter {
        private final Canvas canvas;
        private final float k;
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint music = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);

        CanvasPainter(Canvas canvas, float k) {
            this.canvas = canvas; this.k = k;
            fill.setColor(Color.BLACK); fill.setStyle(Paint.Style.FILL);
            stroke.setColor(Color.BLACK); stroke.setStyle(Paint.Style.STROKE); stroke.setStrokeCap(Paint.Cap.BUTT);
            music.setColor(Color.BLACK); music.setTypeface(musicFont);
            text.setColor(Color.BLACK);
        }

        @Override public void line(float x1, float y1, float x2, float y2, float width) {
            stroke.setStrokeWidth(Math.max(1f, width * k));
            canvas.drawLine(x1 * k, y1 * k, x2 * k, y2 * k, stroke);
        }

        @Override public void polygon(float[] points) {
            Path path = new Path();
            path.moveTo(points[0] * k, points[1] * k);
            for (int i = 2; i + 1 < points.length; i += 2) path.lineTo(points[i] * k, points[i + 1] * k);
            path.close();
            canvas.drawPath(path, fill);
        }

        @Override public void curveBand(float x1, float y1, float ax, float ay, float bx, float by,
                                        float cx, float cy, float dx, float dy, float x2, float y2) {
            Path path = new Path();
            path.moveTo(x1 * k, y1 * k);
            path.cubicTo(ax * k, ay * k, bx * k, by * k, x2 * k, y2 * k);
            path.cubicTo(dx * k, dy * k, cx * k, cy * k, x1 * k, y1 * k);
            path.close();
            canvas.drawPath(path, fill);
        }

        @Override public void glyph(char glyph, float x, float y, float scale) {
            music.setTextSize(4 * k * scale);
            canvas.drawText(String.valueOf(glyph), x * k, y * k, music);
        }

        private static Typeface serif(int style) {
            boolean bold = (style & BOLD) != 0, italic = (style & ITALIC) != 0;
            return Typeface.create(Typeface.SERIF, bold && italic ? Typeface.BOLD_ITALIC
                    : bold ? Typeface.BOLD : italic ? Typeface.ITALIC : Typeface.NORMAL);
        }

        private void textStyle(float size, int style) {
            text.setTypeface(serif(style));
            text.setTextSize(size);
        }

        @Override public void text(String value, float x, float y, float size, int style, int align) {
            if (value == null || value.isEmpty()) return;
            float width = textWidth(value, size, style);
            float cursor = align == CENTER ? x - width / 2 : align == RIGHT ? x - width : x;
            textStyle(size * k, style);
            music.setTextSize(size * k);
            int start = 0;
            // Text runs alternate between the text font and music symbols such as metronome notes.
            while (start < value.length()) {
                boolean symbol = Glyphs.isMusic(value.charAt(start));
                int end = start;
                while (end < value.length() && Glyphs.isMusic(value.charAt(end)) == symbol) end++;
                String run = value.substring(start, end);
                canvas.drawText(run, cursor * k, y * k, symbol ? music : text);
                cursor += runWidth(run, size, style, symbol);
                start = end;
            }
        }

        private float runWidth(String run, float size, int style, boolean symbol) {
            if (symbol) {
                float width = 0;
                for (char c : run.toCharArray()) width += Glyphs.width(c) * size / 4f + 0.1f;
                return width;
            }
            Paint measure = new Paint(Paint.ANTI_ALIAS_FLAG);
            measure.setTypeface(serif(style));
            measure.setTextSize(100f);
            return measure.measureText(run) * size / 100f;
        }

        @Override public float textWidth(String value, float size, int style) {
            if (value == null || value.isEmpty()) return 0;
            float width = 0;
            int start = 0;
            while (start < value.length()) {
                boolean symbol = Glyphs.isMusic(value.charAt(start));
                int end = start;
                while (end < value.length() && Glyphs.isMusic(value.charAt(end)) == symbol) end++;
                width += runWidth(value.substring(start, end), size, style, symbol);
                start = end;
            }
            return width;
        }

        @Override public void frame(float left, float top, float right, float bottom, float width) {
            stroke.setStrokeWidth(Math.max(1f, width * k));
            canvas.drawRect(left * k, top * k, right * k, bottom * k, stroke);
        }
    }
}
