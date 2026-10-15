package de.jagdhorn.notenleser;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class MainActivity extends Activity {
    private static final int PICK_PDF = 41;
    private Uri pdfUri;
    private ParcelFileDescriptor descriptor;
    private PdfRenderer renderer;
    private File cachedPdf;
    private int pageIndex = 0;
    private int systemIndex = 0;
    private int visibleSystemCount = 1;
    private int openRequestId = 0;
    private int systemsPerPage = 4;
    private boolean autoDetection = true;
    private final List<PageSystems> pageSystems = new ArrayList<>();
    private final Handler uiHandler = new Handler();
    private final Runnable hideControlsTask = this::hideControls;
    private ImageView scoreView;
    private TextView info;
    private TextView detectionButton;
    private LinearLayout topOverlay;
    private LinearLayout bottomOverlay;
    private String displayName = "Keine Noten geöffnet";
    private float touchY;
    private float touchX;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();
        buildUi();
        String saved = getPreferences(MODE_PRIVATE).getString("pdf", null);
        if (saved != null) openPdf(Uri.parse(saved));
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private TextView button(String label, Runnable action) {
        TextView b = new TextView(this);
        b.setText(label); b.setTextSize(14); b.setTextColor(Color.WHITE);
        b.setGravity(Gravity.CENTER); b.setSingleLine(true);
        b.setPadding(dp(12), dp(10), dp(12), dp(10)); b.setMinHeight(dp(44));
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(Color.rgb(54, 61, 72)); shape.setCornerRadius(dp(18));
        shape.setStroke(dp(1), Color.argb(90, 255, 255, 255));
        b.setBackground(shape); b.setElevation(dp(3));
        b.setOnClickListener(v -> { showControls(); action.run(); });
        return b;
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this); root.setBackgroundColor(Color.BLACK);
        scoreView = new ImageView(this); scoreView.setBackgroundColor(Color.BLACK); scoreView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        scoreView.setOnTouchListener((v, e) -> {
            if (e.getAction() == MotionEvent.ACTION_DOWN) { touchX = e.getX(); touchY = e.getY(); return true; }
            if (e.getAction() == MotionEvent.ACTION_UP) {
                float dx = e.getX() - touchX, dy = e.getY() - touchY;
                if (Math.abs(dx) > Math.max(dp(48), v.getWidth() * .12f) && Math.abs(dx) > Math.abs(dy)) {
                    showControls(); if (dx < 0) next(); else previous();
                } else if (Math.abs(dx) < dp(16) && Math.abs(dy) < dp(16)) toggleControls();
                return true;
            }
            return true;
        });
        scoreView.addOnLayoutChangeListener((v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if ((right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) && renderer != null)
                renderSystem();
        });
        root.addView(scoreView, new FrameLayout.LayoutParams(-1, -1));

        topOverlay = new LinearLayout(this); topOverlay.setOrientation(LinearLayout.VERTICAL);
        topOverlay.setPadding(dp(12), dp(8), dp(12), dp(8)); topOverlay.setBackground(panelBackground());
        info = new TextView(this); info.setTextColor(Color.WHITE); info.setTextSize(14);
        info.setMaxLines(2); info.setEllipsize(android.text.TextUtils.TruncateAt.END);
        info.setGravity(Gravity.CENTER_VERTICAL); info.setPadding(dp(4), dp(2), dp(4), dp(6));
        topOverlay.addView(info, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout tools = new LinearLayout(this); tools.setGravity(Gravity.CENTER_VERTICAL);
        TextView open = button("PDF öffnen", this::pickPdf);
        TextView minus = button("−", () -> changeSystemCount(-1));
        detectionButton = button("Auto an", this::toggleDetection);
        TextView plus = button("+", () -> changeSystemCount(1));
        addTool(tools, open, 1.25f); addTool(tools, minus, .55f);
        addTool(tools, detectionButton, 1.0f); addTool(tools, plus, .55f);
        topOverlay.addView(tools, new LinearLayout.LayoutParams(-1, -2));
        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(-1, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        topParams.setMargins(dp(10), dp(12), dp(10), 0);
        root.addView(topOverlay, topParams);

        bottomOverlay = new LinearLayout(this); bottomOverlay.setGravity(Gravity.CENTER);
        bottomOverlay.setPadding(dp(8), dp(6), dp(8), dp(6)); bottomOverlay.setBackground(panelBackground());
        TextView previous = button("‹   Zurück", this::previous);
        TextView next = button("Weiter   ›", this::next);
        addTool(bottomOverlay, previous, 1); addTool(bottomOverlay, next, 1);
        FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        bottomParams.setMargins(dp(10), 0, dp(10), dp(12));
        root.addView(bottomOverlay, bottomParams);
        setContentView(root); refreshInfo(); showControls();
    }

    private void addTool(LinearLayout row, View child, float weight) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, weight);
        lp.setMargins(dp(3), 0, dp(3), 0); row.addView(child, lp);
    }

    private GradientDrawable panelBackground() {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(220, 24, 28, 34)); bg.setCornerRadius(dp(22));
        bg.setStroke(dp(1), Color.argb(75, 255, 255, 255)); return bg;
    }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void showControls() {
        if (topOverlay == null || bottomOverlay == null) return;
        uiHandler.removeCallbacks(hideControlsTask);
        for (View view : new View[]{topOverlay, bottomOverlay}) {
            view.setVisibility(View.VISIBLE); view.animate().cancel(); view.setAlpha(1f);
        }
        uiHandler.postDelayed(hideControlsTask, 3500);
    }

    private void hideControls() {
        if (topOverlay == null || bottomOverlay == null) return;
        for (View view : new View[]{topOverlay, bottomOverlay}) {
            view.animate().alpha(0f).setDuration(350).withEndAction(() -> view.setVisibility(View.INVISIBLE));
        }
    }

    private void toggleControls() {
        if (topOverlay.getVisibility() == View.VISIBLE) {
            uiHandler.removeCallbacks(hideControlsTask); hideControls();
        } else showControls();
    }

    private void pickPdf() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/pdf"); i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(i, PICK_PDF);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_PDF && result == RESULT_OK && data != null) {
            Uri u = data.getData();
            try { getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) { }
            openPdf(u);
        }
    }

    private String describeCause(Throwable error) {
        Throwable cause = error;
        while (cause.getCause() != null && cause.getCause() != cause) cause = cause.getCause();
        String message = cause.getMessage();
        return cause.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private void openPdf(Uri uri) {
        if (uri == null) {
            Toast.makeText(this, "Die Dateiauswahl hat keinen Datei-URI zurückgegeben", Toast.LENGTH_LONG).show();
            return;
        }
        final int requestId = ++openRequestId;
        closePdf();
        Toast.makeText(this, "PDF wird geladen …", Toast.LENGTH_SHORT).show();
        new Thread(() -> loadPdf(uri, requestId), "notenleser-pdf-loader").start();
    }

    private void loadPdf(Uri uri, int requestId) {
        File localCopy = null;
        ParcelFileDescriptor localDescriptor = null;
        PdfRenderer localRenderer = null;
        try {
            localCopy = File.createTempFile("notenleser_", ".pdf", getCacheDir());
            try (InputStream input = getContentResolver().openInputStream(uri);
                 OutputStream output = new FileOutputStream(localCopy)) {
                if (input == null) throw new IOException("Nextcloud hat keinen lesbaren Dateistream geliefert");
                byte[] buffer = new byte[32 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            }
            localDescriptor = ParcelFileDescriptor.open(localCopy, ParcelFileDescriptor.MODE_READ_ONLY);
            localRenderer = new PdfRenderer(localDescriptor);
            final String loadedName = queryDisplayName(uri);
            final File loadedFile = localCopy;
            final ParcelFileDescriptor loadedDescriptor = localDescriptor;
            final PdfRenderer loadedRenderer = localRenderer;
            runOnUiThread(() -> {
                if (requestId != openRequestId || isFinishing() || isDestroyed()) {
                    loadedRenderer.close();
                    try { loadedDescriptor.close(); } catch (IOException ignored) { }
                    loadedFile.delete();
                    return;
                }
                cachedPdf = loadedFile;
                descriptor = loadedDescriptor;
                renderer = loadedRenderer;
                displayName = loadedName;
                pdfUri = uri; pageIndex = 0; systemIndex = 0;
                pageSystems.clear();
                for (int i = 0; i < renderer.getPageCount(); i++) pageSystems.add(null);
                getPreferences(MODE_PRIVATE).edit().putString("pdf", uri.toString()).apply();
                renderSystem();
            });
        } catch (Exception e) {
            if (localRenderer != null) localRenderer.close();
            if (localDescriptor != null) try { localDescriptor.close(); } catch (IOException ignored) { }
            if (localCopy != null) localCopy.delete();
            final String details = describeCause(e);
            runOnUiThread(() -> {
                if (requestId == openRequestId && !isFinishing() && !isDestroyed())
                    Toast.makeText(this, "PDF-Lesefehler: " + details, Toast.LENGTH_LONG).show();
            });
        }
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String name = cursor.getString(column);
                    if (name != null && !name.trim().isEmpty() && !name.matches("[0-9]{5,}")) return name;
                }
            }
        } catch (Exception ignored) { }
        return "Noten-PDF";
    }

    private void closePdf() {
        if (renderer != null) { renderer.close(); renderer = null; }
        if (descriptor != null) { try { descriptor.close(); } catch (IOException ignored) { } descriptor = null; }
        if (cachedPdf != null) { cachedPdf.delete(); cachedPdf = null; }
    }

    private void changeSystemCount(int delta) {
        if (autoDetection) {
            Toast.makeText(this, "Für manuelle Einteilung zuerst Auto antippen", Toast.LENGTH_SHORT).show();
            return;
        }
        systemsPerPage = Math.max(1, Math.min(12, systemsPerPage + delta));
        systemIndex = Math.min(systemIndex, systemsPerPage - 1); renderSystem();
    }

    private void toggleDetection() {
        autoDetection = !autoDetection;
        detectionButton.setText(autoDetection ? "Auto an" : "Auto aus");
        systemIndex = 0;
        Toast.makeText(this, autoDetection ? "Automatische Notensystem-Erkennung" : "Manuelle Seiteneinteilung", Toast.LENGTH_SHORT).show();
        renderSystem();
    }

    private void next() {
        if (renderer == null) { pickPdf(); return; }
        int count = currentSystemCount();
        if (systemIndex + 1 < count) systemIndex++;
        else {
            int nextPage = autoDetection ? findScorePage(pageIndex + 1, 1) :
                    (pageIndex + 1 < renderer.getPageCount() ? pageIndex + 1 : -1);
            if (nextPage >= 0) { pageIndex = nextPage; systemIndex = 0; }
            else Toast.makeText(this, "Ende der Noten", Toast.LENGTH_SHORT).show();
        }
        renderSystem();
    }

    private void previous() {
        if (renderer == null) { pickPdf(); return; }
        if (systemIndex > 0) systemIndex--;
        else {
            int previousPage = autoDetection ? findScorePage(pageIndex - 1, -1) : pageIndex - 1;
            if (previousPage >= 0) { pageIndex = previousPage; systemIndex = Math.max(0, currentSystemCount() - 1); }
            else Toast.makeText(this, "Anfang der Noten", Toast.LENGTH_SHORT).show();
        }
        renderSystem();
    }

    private int findScorePage(int startPage, int direction) {
        if (renderer == null) return -1;
        int width = Math.max(scoreView.getWidth(), 1200);
        for (int i = startPage; i >= 0 && i < renderer.getPageCount(); i += direction) {
            PageSystems systems = pageSystems.get(i);
            if (systems == null) {
                PdfRenderer.Page page = renderer.openPage(i);
                try {
                    int height = Math.max(1, Math.round(width * page.getHeight() / (float) page.getWidth()));
                    Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                    bitmap.eraseColor(Color.WHITE);
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    systems = detectSystems(bitmap);
                    pageSystems.set(i, systems);
                    bitmap.recycle();
                } finally { page.close(); }
            }
            if (systems.count() > 0) return i;
        }
        return -1;
    }

    private void renderSystem() {
        refreshInfo();
        if (renderer == null || scoreView == null) return;
        if (scoreView.getWidth() < 1 || scoreView.getHeight() < 1) { scoreView.post(this::renderSystem); return; }
        PdfRenderer.Page page = renderer.openPage(pageIndex);
        boolean pageClosed = false;
        try {
            int width = Math.max(scoreView.getWidth(), 1200);
            int height = Math.max(1, Math.round(width * page.getHeight() / (float) page.getWidth()));
            Bitmap whole = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            whole.eraseColor(Color.WHITE);
            page.render(whole, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            PageSystems detected = pageSystems.get(pageIndex);
            if (detected == null) {
                detected = detectSystems(whole);
                pageSystems.set(pageIndex, detected);
            }
            if (autoDetection && detected.count() == 0 && pageIndex + 1 < renderer.getPageCount()) {
                page.close(); pageClosed = true;
                int nextScorePage = findScorePage(pageIndex + 1, 1);
                if (nextScorePage >= 0) {
                    whole.recycle(); pageIndex = nextScorePage; systemIndex = 0;
                    renderSystem();
                    return;
                }
            }
            int count = autoDetection && detected.count() > 0 ? detected.count() : systemsPerPage;
            systemIndex = Math.min(systemIndex, count - 1);
            refreshInfo();
            boolean useDetection = autoDetection && detected.count() > 0;
            int top = systemTop(systemIndex, height, count, detected, useDetection);
            int lastSystem = systemIndex;
            int bottom = systemBottom(lastSystem, height, count, detected, useDetection);
            int maxCropHeight = Math.round(scoreView.getHeight() * (width / (float) scoreView.getWidth()));
            while (lastSystem + 1 < count) {
                int candidateBottom = systemBottom(lastSystem + 1, height, count, detected, useDetection);
                if (candidateBottom - top > maxCropHeight) break;
                lastSystem++;
                bottom = candidateBottom;
            }
            visibleSystemCount = lastSystem - systemIndex + 1;
            refreshInfo();
            Bitmap crop = Bitmap.createBitmap(whole, 0, top, width, Math.max(1, bottom - top));
            drawSystemMarkers(crop, top, height, count, detected, useDetection, systemIndex, lastSystem);
            scoreView.setImageBitmap(crop); whole.recycle();
        } catch (Exception e) { Toast.makeText(this, "Seite konnte nicht dargestellt werden", Toast.LENGTH_SHORT).show(); }
        finally { if (!pageClosed) page.close(); }
    }

    private int systemTop(int index, int pageHeight, int count, PageSystems detected, boolean useDetection) {
        return useDetection ? detected.top[index] : Math.round(pageHeight * (index / (float) count));
    }

    private int systemBottom(int index, int pageHeight, int count, PageSystems detected, boolean useDetection) {
        return useDetection ? detected.bottom[index] : Math.round(pageHeight * ((index + 1) / (float) count));
    }

    private void drawSystemMarkers(Bitmap crop, int cropTop, int pageHeight, int count, PageSystems detected,
                                   boolean useDetection, int firstSystem, int lastSystem) {
        Canvas canvas = new Canvas(crop);
        float displayScale = Math.min(scoreView.getWidth() / (float) crop.getWidth(), scoreView.getHeight() / (float) crop.getHeight());
        if (displayScale <= 0) return;
        Paint separator = new Paint(Paint.ANTI_ALIAS_FLAG);
        separator.setColor(Color.argb(125, 70, 78, 86));
        separator.setStrokeWidth(Math.max(1f, dp(1) / displayScale));
        Paint badge = new Paint(Paint.ANTI_ALIAS_FLAG);
        badge.setColor(Color.argb(220, 35, 43, 52));
        Paint number = new Paint(Paint.ANTI_ALIAS_FLAG);
        number.setColor(Color.WHITE); number.setTextAlign(Paint.Align.CENTER);
        number.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        number.setTextSize(dp(13) / displayScale);
        float badgeWidth = dp(30) / displayScale, badgeHeight = dp(22) / displayScale;
        float x = dp(8) / displayScale;
        for (int system = firstSystem; system <= lastSystem; system++) {
            int relativeTop = systemTop(system, pageHeight, count, detected, useDetection) - cropTop;
            float y = relativeTop + dp(4) / displayScale;
            RectF rect = new RectF(x, y, x + badgeWidth, y + badgeHeight);
            canvas.drawRoundRect(rect, badgeHeight / 2, badgeHeight / 2, badge);
            Paint.FontMetrics fm = number.getFontMetrics();
            canvas.drawText(String.valueOf(system + 1), rect.centerX(), rect.centerY() - (fm.ascent + fm.descent) / 2, number);
            if (system < lastSystem) {
                int gapTop = systemBottom(system, pageHeight, count, detected, useDetection) - cropTop;
                int gapBottom = systemTop(system + 1, pageHeight, count, detected, useDetection) - cropTop;
                canvas.drawLine(0, (gapTop + gapBottom) / 2f, crop.getWidth(), (gapTop + gapBottom) / 2f, separator);
            }
        }
    }

    private int currentSystemCount() {
        if (!autoDetection || pageIndex >= pageSystems.size()) return systemsPerPage;
        PageSystems systems = pageSystems.get(pageIndex);
        return systems == null || systems.count() == 0 ? systemsPerPage : systems.count();
    }

    /** Finds sets of five long horizontal staff lines, then combines nearby staves into systems. */
    private PageSystems detectSystems(Bitmap image) {
        int width = image.getWidth(), height = image.getHeight();
        int left = width / 20, right = width * 19 / 20;
        int scanWidth = right - left;
        int[] pixels = new int[width * height];
        image.getPixels(pixels, 0, width, 0, 0, width, height);
        ArrayList<Integer> rows = new ArrayList<>();
        for (int y = 0; y < height; y++) {
            int dark = 0, offset = y * width;
            for (int x = left; x < right; x++) {
                int c = pixels[offset + x];
                int luminance = (Color.red(c) * 299 + Color.green(c) * 587 + Color.blue(c) * 114) / 1000;
                if (luminance < 135) dark++;
            }
            if (dark >= scanWidth * 0.52f) rows.add(y);
        }
        ArrayList<Integer> lines = new ArrayList<>();
        for (int i = 0; i < rows.size();) {
            int start = rows.get(i), end = start, j = i + 1;
            while (j < rows.size() && rows.get(j) <= end + 2) end = rows.get(j++);
            lines.add((start + end) / 2);
            i = j;
        }
        ArrayList<Staff> staffs = new ArrayList<>();
        int maxSpacing = Math.max(8, height / 30);
        for (int i = 0; i + 4 < lines.size();) {
            int a = lines.get(i), b = lines.get(i + 1), c = lines.get(i + 2), d = lines.get(i + 3), e = lines.get(i + 4);
            int s1 = b - a, s2 = c - b, s3 = d - c, s4 = e - d;
            int spacing = (e - a) / 4;
            boolean regular = spacing >= 3 && spacing <= maxSpacing &&
                    Math.abs(s1 - spacing) <= spacing * .35f && Math.abs(s2 - spacing) <= spacing * .35f &&
                    Math.abs(s3 - spacing) <= spacing * .35f && Math.abs(s4 - spacing) <= spacing * .35f;
            if (regular) { staffs.add(new Staff(a, e, spacing)); i += 5; }
            else i++;
        }
        if (staffs.isEmpty()) return new PageSystems(new int[0], new int[0]);
        ArrayList<Float> gapRatios = new ArrayList<>();
        for (int i = 1; i < staffs.size(); i++) {
            Staff previous = staffs.get(i - 1), next = staffs.get(i);
            gapRatios.add((next.top - previous.bottom) / (float) Math.max(previous.spacing, next.spacing));
        }
        float systemGap = 6.0f;
        if (gapRatios.size() >= 2) {
            Collections.sort(gapRatios);
            float largestGap = 0;
            int split = -1;
            for (int i = 0; i + 1 < gapRatios.size(); i++) {
                float difference = gapRatios.get(i + 1) - gapRatios.get(i);
                if (difference > largestGap) { largestGap = difference; split = i; }
            }
            // A clear page-wide gap separates adjacent voices from the whitespace between systems.
            if (split >= 0 && largestGap >= 2.0f)
                systemGap = (gapRatios.get(split) + gapRatios.get(split + 1)) / 2.0f;
        }
        ArrayList<Integer> tops = new ArrayList<>(), bottoms = new ArrayList<>();
        Staff first = staffs.get(0), last = first;
        for (int i = 1; i < staffs.size(); i++) {
            Staff next = staffs.get(i);
            if (next.top - last.bottom <= Math.max(last.spacing, next.spacing) * systemGap) {
                last = next;
            } else {
                tops.add(Math.max(0, first.top - first.spacing * 3));
                bottoms.add(Math.min(height, last.bottom + last.spacing * 3));
                first = last = next;
            }
        }
        tops.add(Math.max(0, first.top - first.spacing * 3));
        bottoms.add(Math.min(height, last.bottom + last.spacing * 3));
        int[] top = new int[tops.size()], bottom = new int[bottoms.size()];
        for (int i = 0; i < top.length; i++) { top[i] = tops.get(i); bottom[i] = bottoms.get(i); }
        return new PageSystems(top, bottom);
    }

    private static class Staff {
        final int top, bottom, spacing;
        Staff(int top, int bottom, int spacing) { this.top = top; this.bottom = bottom; this.spacing = spacing; }
    }

    private static class PageSystems {
        final int[] top, bottom;
        PageSystems(int[] top, int[] bottom) { this.top = top; this.bottom = bottom; }
        int count() { return top.length; }
    }

    private void refreshInfo() {
        if (info == null) return;
        int count = currentSystemCount();
        boolean detected = autoDetection && pageIndex < pageSystems.size() && pageSystems.get(pageIndex) != null && pageSystems.get(pageIndex).count() > 0;
        int lastVisible = Math.min(count, systemIndex + visibleSystemCount);
        String systems = visibleSystemCount > 1 ? (systemIndex + 1) + "–" + lastVisible : String.valueOf(systemIndex + 1);
        info.setText(displayName + (renderer == null ? "" : "\nSeite " + (pageIndex + 1) + "/" + renderer.getPageCount() + "   •   System " + systems + "/" + count + (autoDetection ? (detected ? " Auto" : " Fallback") : " Manuell")));
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) { super.onWindowFocusChanged(hasFocus); if (hasFocus) immersive(); }
    @Override protected void onDestroy() { openRequestId++; uiHandler.removeCallbacks(hideControlsTask); closePdf(); super.onDestroy(); }
}


