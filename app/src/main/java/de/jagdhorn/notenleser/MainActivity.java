package de.jagdhorn.notenleser;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class MainActivity extends Activity {
    private static final int PICK_PDF = 41;
    private Uri pdfUri;
    private ParcelFileDescriptor descriptor;
    private PdfRenderer renderer;
    private int pageIndex = 0;
    private int systemIndex = 0;
    private int systemsPerPage = 4;
    private boolean autoDetection = true;
    private final List<PageSystems> pageSystems = new ArrayList<>();
    private ImageView scoreView;
    private TextView info;
    private Button detectionButton;
    private float touchX;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();
        buildUi();
        String saved = getPreferences(MODE_PRIVATE).getString("pdf", null);
        if (saved != null) {
            try { openPdf(Uri.parse(saved)); } catch (Exception ignored) { }
        }
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private Button button(String label, Runnable action) {
        Button b = new Button(this); b.setText(label); b.setTextSize(16); b.setAllCaps(false);
        b.setOnClickListener(v -> action.run()); return b;
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.BLACK);
        LinearLayout header = new LinearLayout(this); header.setGravity(Gravity.CENTER_VERTICAL); header.setPadding(6, 2, 6, 2);
        info = new TextView(this); info.setTextColor(Color.WHITE); info.setTextSize(14); info.setGravity(Gravity.CENTER);
        header.addView(info, new LinearLayout.LayoutParams(0, -2, 1));
        header.addView(button("−", () -> changeSystemCount(-1)));
        detectionButton = button("Auto an", this::toggleDetection);
        header.addView(detectionButton);
        header.addView(button("+", () -> changeSystemCount(1)));
        root.addView(header, new LinearLayout.LayoutParams(-1, -2));

        scoreView = new ImageView(this); scoreView.setBackgroundColor(Color.BLACK); scoreView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        scoreView.setOnTouchListener((v, e) -> {
            if (e.getAction() == MotionEvent.ACTION_DOWN) { touchX = e.getX(); return true; }
            if (e.getAction() == MotionEvent.ACTION_UP) {
                float dx = e.getX() - touchX;
                if (Math.abs(dx) > Math.max(48, v.getWidth() * .12f)) { if (dx < 0) next(); else previous(); }
                return true;
            }
            return true;
        });
        root.addView(scoreView, new LinearLayout.LayoutParams(-1, 0, 1));

        LinearLayout controls = new LinearLayout(this); controls.setGravity(Gravity.CENTER); controls.setPadding(4, 0, 4, 4);
        controls.addView(button("◀  Zurück", this::previous), new LinearLayout.LayoutParams(0, -2, 1));
        controls.addView(button("PDF öffnen", this::pickPdf), new LinearLayout.LayoutParams(0, -2, 1));
        controls.addView(button("Weiter  ▶", this::next), new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(controls, new LinearLayout.LayoutParams(-1, -2));
        setContentView(root); refreshInfo();
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
            try { openPdf(u); } catch (Exception e) { Toast.makeText(this, "PDF kann nicht geöffnet werden: " + e.getMessage(), Toast.LENGTH_LONG).show(); }
        }
    }

    private void openPdf(Uri uri) throws IOException {
        closePdf();
        descriptor = getContentResolver().openFileDescriptor(uri, "r");
        if (descriptor == null) throw new IOException("Datei nicht verfügbar");
        renderer = new PdfRenderer(descriptor); pdfUri = uri; pageIndex = 0; systemIndex = 0;
        pageSystems.clear();
        for (int i = 0; i < renderer.getPageCount(); i++) pageSystems.add(null);
        getPreferences(MODE_PRIVATE).edit().putString("pdf", uri.toString()).apply();
        renderSystem();
    }

    private void closePdf() {
        if (renderer != null) { renderer.close(); renderer = null; }
        if (descriptor != null) { try { descriptor.close(); } catch (IOException ignored) { } descriptor = null; }
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
        else if (pageIndex + 1 < renderer.getPageCount()) { pageIndex++; systemIndex = 0; }
        else { Toast.makeText(this, "Ende der Noten", Toast.LENGTH_SHORT).show(); }
        renderSystem();
    }

    private void previous() {
        if (renderer == null) { pickPdf(); return; }
        if (systemIndex > 0) systemIndex--;
        else if (pageIndex > 0) { pageIndex--; systemIndex = Math.max(0, currentSystemCount() - 1); }
        else { Toast.makeText(this, "Anfang der Noten", Toast.LENGTH_SHORT).show(); }
        renderSystem();
    }

    private void renderSystem() {
        refreshInfo();
        if (renderer == null || scoreView == null) return;
        if (scoreView.getWidth() < 1) { scoreView.post(this::renderSystem); return; }
        PdfRenderer.Page page = renderer.openPage(pageIndex);
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
            int count = autoDetection && detected.count() > 0 ? detected.count() : systemsPerPage;
            systemIndex = Math.min(systemIndex, count - 1);
            refreshInfo();
            int top = autoDetection && detected.count() > 0 ? detected.top[systemIndex] : Math.round(height * (systemIndex / (float) count));
            int bottom = autoDetection && detected.count() > 0 ? detected.bottom[systemIndex] : Math.round(height * ((systemIndex + 1) / (float) count));
            Bitmap crop = Bitmap.createBitmap(whole, 0, top, width, Math.max(1, bottom - top));
            scoreView.setImageBitmap(crop); whole.recycle();
        } catch (Exception e) { Toast.makeText(this, "Seite konnte nicht dargestellt werden", Toast.LENGTH_SHORT).show(); }
        finally { page.close(); }
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
                tops.add(Math.max(0, first.top - first.spacing * 2));
                bottoms.add(Math.min(height, last.bottom + last.spacing * 2));
                first = last = next;
            }
        }
        tops.add(Math.max(0, first.top - first.spacing * 2));
        bottoms.add(Math.min(height, last.bottom + last.spacing * 2));
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
        String name = pdfUri == null ? "Keine Noten geöffnet" : pdfUri.getLastPathSegment();
        int count = currentSystemCount();
        boolean detected = autoDetection && pageIndex < pageSystems.size() && pageSystems.get(pageIndex) != null && pageSystems.get(pageIndex).count() > 0;
        info.setText(name + (renderer == null ? "" : "   •   Seite " + (pageIndex + 1) + "   •   System " + (systemIndex + 1) + "/" + count + (autoDetection ? (detected ? " Auto" : " (Fallback)") : " Manuell")));
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) { super.onWindowFocusChanged(hasFocus); if (hasFocus) immersive(); }
    @Override protected void onDestroy() { closePdf(); super.onDestroy(); }
}


