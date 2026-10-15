package de.jagdhorn.notenleser;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.provider.DocumentsContract;
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
import java.util.Comparator;
import java.util.List;

public class MainActivity extends Activity {
    private static final int PICK_PDF = 41;
    private static final int PICK_FOLDER = 42;
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
    private final List<Uri> folderPdfs = new ArrayList<>();
    private int folderPdfIndex = -1;
    private final Handler uiHandler = new Handler();
    private final Runnable hideControlsTask = this::hideControls;
    private ImageView scoreView;
    private TextView info;
    private TextView detectionButton;
    private LinearLayout topOverlay;
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
        shape.setColor(Color.argb(96, 54, 61, 72)); shape.setCornerRadius(dp(18));
        shape.setStroke(dp(1), Color.argb(70, 255, 255, 255));
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
        info.setMaxWidth(dp(330));
        info.setGravity(Gravity.CENTER_VERTICAL); info.setPadding(dp(4), dp(2), dp(4), dp(6));
        topOverlay.addView(info, new LinearLayout.LayoutParams(-2, -2));
        LinearLayout tools = new LinearLayout(this); tools.setGravity(Gravity.CENTER_VERTICAL);
        TextView open = button("Öffnen", this::chooseSource);
        TextView minus = button("−", () -> changeSystemCount(-1));
        detectionButton = button("Auto an", this::toggleDetection);
        TextView plus = button("+", () -> changeSystemCount(1));
        TextView previous = button("‹", this::previous); previous.setContentDescription("Vorheriges System");
        TextView next = button("›", this::next); next.setContentDescription("Nächstes System");
        previous.setTextSize(22); next.setTextSize(22);
        previous.setPadding(dp(4), dp(10), dp(4), dp(10)); next.setPadding(dp(4), dp(10), dp(4), dp(10));
        addTool(tools, open); addTool(tools, previous); addTool(tools, minus);
        addTool(tools, detectionButton); addTool(tools, plus); addTool(tools, next);
        topOverlay.addView(tools, new LinearLayout.LayoutParams(-2, -2));
        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.LEFT);
        topParams.setMargins(dp(10), dp(12), 0, 0);
        root.addView(topOverlay, topParams);

        setContentView(root); refreshInfo(); showControls();
    }

    private void addTool(LinearLayout row, View child) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.setMargins(dp(3), 0, dp(3), 0); row.addView(child, lp);
    }

    private GradientDrawable panelBackground() {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(78, 24, 28, 34)); bg.setCornerRadius(dp(22));
        bg.setStroke(dp(1), Color.argb(45, 255, 255, 255)); return bg;
    }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void showControls() {
        if (topOverlay == null) return;
        uiHandler.removeCallbacks(hideControlsTask);
        topOverlay.setVisibility(View.VISIBLE); topOverlay.animate().cancel(); topOverlay.setAlpha(1f);
        uiHandler.postDelayed(hideControlsTask, 3500);
    }

    private void hideControls() {
        if (topOverlay == null) return;
        topOverlay.animate().alpha(0f).setDuration(350).withEndAction(() -> topOverlay.setVisibility(View.INVISIBLE));
    }

    private void toggleControls() {
        if (topOverlay.getVisibility() == View.VISIBLE) {
            uiHandler.removeCallbacks(hideControlsTask); hideControls();
        } else showControls();
    }

    private void chooseSource() {
        new AlertDialog.Builder(this)
                .setTitle("Noten öffnen")
                .setItems(new String[]{"Einzelne PDF auswählen", "Ordner mit PDFs auswählen"}, (dialog, which) -> {
                    if (which == 0) pickPdf(); else pickFolder();
                }).show();
    }

    private void pickPdf() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/pdf"); i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(i, PICK_PDF);
    }

    private void pickFolder() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(i, PICK_FOLDER);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FOLDER && result == RESULT_OK && data != null && data.getData() != null) {
            Uri tree = data.getData();
            try { getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) { }
            new Thread(() -> loadFolderPdfs(tree), "notenleser-folder-loader").start();
            return;
        }
        if (request == PICK_PDF && result == RESULT_OK && data != null) {
            Uri u = data.getData();
            try { getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) { }
            folderPdfs.clear(); folderPdfIndex = -1;
            openPdf(u);
        }
    }

    private void loadFolderPdfs(Uri tree) {
        List<Uri> found = new ArrayList<>();
        try {
            String rootId = DocumentsContract.getTreeDocumentId(tree);
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootId);
            String[] columns = {DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE};
            try (Cursor cursor = getContentResolver().query(children, columns, null, null, null)) {
                if (cursor != null) {
                    int idColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                    int nameColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                    int mimeColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
                    while (cursor.moveToNext()) {
                        String name = nameColumn >= 0 ? cursor.getString(nameColumn) : "";
                        String mime = mimeColumn >= 0 ? cursor.getString(mimeColumn) : "";
                        if (idColumn >= 0 && name != null && name.toLowerCase(java.util.Locale.ROOT).endsWith(".pdf")
                                && !DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                            found.add(DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(idColumn)));
                        }
                    }
                }
            }
            found.sort(Comparator.comparing(this::queryDisplayName, String.CASE_INSENSITIVE_ORDER));
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                if (found.isEmpty()) {
                    Toast.makeText(this, "In diesem Ordner wurden keine PDFs gefunden", Toast.LENGTH_LONG).show();
                    return;
                }
                folderPdfs.clear(); folderPdfs.addAll(found); folderPdfIndex = 0;
                openPdf(folderPdfs.get(0));
                Toast.makeText(this, found.size() + " PDFs im Ordner gefunden", Toast.LENGTH_SHORT).show();
            });
        } catch (Exception e) {
            String details = describeCause(e);
            runOnUiThread(() -> Toast.makeText(this, "Ordner konnte nicht gelesen werden: " + details, Toast.LENGTH_LONG).show());
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
            else if (folderPdfIndex >= 0 && folderPdfIndex + 1 < folderPdfs.size()) {
                folderPdfIndex++;
                openPdf(folderPdfs.get(folderPdfIndex));
                return;
            } else Toast.makeText(this, "Ende der Noten", Toast.LENGTH_SHORT).show();
        }
        renderSystem();
    }

    private void previous() {
        if (renderer == null) { pickPdf(); return; }
        if (systemIndex > 0) systemIndex--;
        else {
            int previousPage = autoDetection ? findScorePage(pageIndex - 1, -1) : pageIndex - 1;
            if (previousPage >= 0) { pageIndex = previousPage; systemIndex = Math.max(0, currentSystemCount() - 1); }
            else if (folderPdfIndex > 0) {
                folderPdfIndex--;
                openPdf(folderPdfs.get(folderPdfIndex));
                return;
            } else Toast.makeText(this, "Anfang der Noten", Toast.LENGTH_SHORT).show();
        }
        renderSystem();
    }

    private int findScorePage(int startPage, int direction) {
        if (renderer == null) return -1;
        int width = Math.max(scoreView.getWidth(), 1200);
        for (int i = startPage; i >= 0 && i < renderer.getPageCount(); i += direction) {
            PageSystems systems = getPageSystems(i, width);
            if (systems.count() > 0) return i;
        }
        return -1;
    }

    private PageSystems getPageSystems(int pageIndex, int width) {
        PageSystems systems = pageSystems.get(pageIndex);
        if (systems != null) return systems;
        Bitmap bitmap = renderPageBitmap(pageIndex, width);
        systems = detectSystems(bitmap);
        bitmap.recycle();
        pageSystems.set(pageIndex, systems);
        return systems;
    }

    private Bitmap renderPageBitmap(int pageIndex, int width) {
        PdfRenderer.Page page = renderer.openPage(pageIndex);
        try {
            int height = Math.max(1, Math.round(width * page.getHeight() / (float) page.getWidth()));
            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            bitmap.eraseColor(Color.WHITE);
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            return bitmap;
        } finally { page.close(); }
    }

    private void renderSystem() {
        refreshInfo();
        if (renderer == null || scoreView == null) return;
        if (scoreView.getWidth() < 1 || scoreView.getHeight() < 1) { scoreView.post(this::renderSystem); return; }
        try {
            int width = Math.max(scoreView.getWidth(), 1200);
            PageSystems detected = getPageSystems(pageIndex, width);
            if (autoDetection && detected.count() == 0 && pageIndex + 1 < renderer.getPageCount()) {
                int nextScorePage = findScorePage(pageIndex + 1, 1);
                if (nextScorePage >= 0) {
                    pageIndex = nextScorePage; systemIndex = 0;
                    renderSystem();
                    return;
                }
            }
            int count = systemCount(pageIndex, detected);
            systemIndex = Math.min(systemIndex, count - 1);
            SystemRef current = systemRef(pageIndex, systemIndex, width);
            if (current == null) return;
            ArrayList<SystemRef> before = new ArrayList<>(), after = new ArrayList<>();
            int maxCropHeight = Math.round(scoreView.getHeight() * (width / (float) scoreView.getWidth()));
            int gapHeight = Math.max(4, Math.round(width * dp(7) / (float) scoreView.getWidth()));
            int usedHeight = current.height();
            SystemRef previousCursor = current, nextCursor = current;
            boolean canLookBack = true, canLookForward = true;
            while (true) {
                boolean added = false;
                if (canLookBack) {
                    SystemRef candidate = adjacentSystem(previousCursor, -1, width);
                    if (candidate == null) canLookBack = false;
                    else if (usedHeight + gapHeight + candidate.height() <= maxCropHeight) {
                        before.add(candidate); previousCursor = candidate;
                        usedHeight += gapHeight + candidate.height(); added = true;
                    } else canLookBack = false;
                }
                if (canLookForward) {
                    SystemRef candidate = adjacentSystem(nextCursor, 1, width);
                    if (candidate == null) canLookForward = false;
                    else if (usedHeight + gapHeight + candidate.height() <= maxCropHeight) {
                        after.add(candidate); nextCursor = candidate;
                        usedHeight += gapHeight + candidate.height(); added = true;
                    } else canLookForward = false;
                }
                if (!added) break;
            }
            ArrayList<SystemRef> visible = new ArrayList<>();
            for (int i = before.size() - 1; i >= 0; i--) visible.add(before.get(i));
            visible.add(current); visible.addAll(after);
            visibleSystemCount = visible.size();
            refreshInfo();
            Bitmap crop = composeSystems(visible, width, gapHeight);
            scoreView.setImageBitmap(crop);
        } catch (Exception e) { Toast.makeText(this, "Seite konnte nicht dargestellt werden", Toast.LENGTH_SHORT).show(); }
    }

    private int systemCount(int page, PageSystems detected) {
        if (autoDetection) return detected.count() > 0 ? detected.count() : systemsPerPage;
        return systemsPerPage;
    }

    private SystemRef systemRef(int page, int index, int width) {
        PageSystems systems = getPageSystems(page, width);
        boolean useDetection = autoDetection && systems.count() > 0;
        int count = systemCount(page, systems);
        if (index < 0 || index >= count) return null;
        PdfRenderer.Page pdfPage = renderer.openPage(page);
        int pageHeight;
        try { pageHeight = Math.max(1, Math.round(width * pdfPage.getHeight() / (float) pdfPage.getWidth())); }
        finally { pdfPage.close(); }
        return new SystemRef(page, index,
                systemTop(index, pageHeight, count, systems, useDetection),
                systemBottom(index, pageHeight, count, systems, useDetection));
    }

    private SystemRef adjacentSystem(SystemRef source, int direction, int width) {
        PageSystems systems = getPageSystems(source.page, width);
        int count = systemCount(source.page, systems);
        int targetIndex = source.index + direction;
        if (targetIndex >= 0 && targetIndex < count) return systemRef(source.page, targetIndex, width);
        int targetPage;
        if (autoDetection) targetPage = findScorePage(source.page + direction, direction);
        else targetPage = source.page + direction;
        if (targetPage < 0 || targetPage >= renderer.getPageCount()) return null;
        PageSystems targetSystems = getPageSystems(targetPage, width);
        int targetCount = systemCount(targetPage, targetSystems);
        if (autoDetection && targetSystems.count() == 0) return null;
        return systemRef(targetPage, direction > 0 ? 0 : targetCount - 1, width);
    }

    private Bitmap composeSystems(List<SystemRef> systems, int width, int gapHeight) {
        int totalHeight = 0;
        for (SystemRef system : systems) totalHeight += system.height();
        totalHeight += gapHeight * Math.max(0, systems.size() - 1);
        Bitmap result = Bitmap.createBitmap(width, totalHeight, Bitmap.Config.ARGB_8888);
        result.eraseColor(Color.WHITE);
        Canvas canvas = new Canvas(result);
        Paint imagePaint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
        float displayScale = Math.min(scoreView.getWidth() / (float) width, scoreView.getHeight() / (float) totalHeight);
        Paint badgePaint = new Paint(Paint.ANTI_ALIAS_FLAG); badgePaint.setColor(Color.argb(205, 35, 43, 52));
        Paint labelPaint = new Paint(Paint.ANTI_ALIAS_FLAG); labelPaint.setColor(Color.WHITE);
        labelPaint.setTextAlign(Paint.Align.CENTER); labelPaint.setTextSize(dp(10) / displayScale);
        labelPaint.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        Paint dividerPaint = new Paint(Paint.ANTI_ALIAS_FLAG); dividerPaint.setColor(Color.argb(145, 75, 83, 91));
        dividerPaint.setStrokeWidth(Math.max(1f, dp(1) / displayScale));
        Bitmap pageBitmap = null; int renderedPage = -1, y = 0;
        try {
            for (int i = 0; i < systems.size(); i++) {
                SystemRef system = systems.get(i);
                if (renderedPage != system.page) {
                    if (pageBitmap != null) pageBitmap.recycle();
                    pageBitmap = renderPageBitmap(system.page, width); renderedPage = system.page;
                }
                int systemHeight = system.height();
                Rect source = new Rect(0, system.top, width, system.bottom);
                Rect destination = new Rect(0, y, width, y + systemHeight);
                canvas.drawBitmap(pageBitmap, source, destination, imagePaint);
                String label = (system.page + 1) + "·" + (system.index + 1);
                float badgeHeight = dp(17) / displayScale;
                float badgeWidth = Math.max(dp(27) / displayScale, labelPaint.measureText(label) + dp(8) / displayScale);
                float badgeX = dp(5) / displayScale;
                float badgeY = y + dp(3) / displayScale;
                RectF badge = new RectF(badgeX, badgeY, badgeX + badgeWidth, badgeY + badgeHeight);
                boolean selected = system.page == pageIndex && system.index == systemIndex;
                badgePaint.setColor(selected ? Color.argb(235, 20, 112, 196) : Color.argb(205, 35, 43, 52));
                canvas.drawRoundRect(badge, badgeHeight / 2, badgeHeight / 2, badgePaint);
                Paint.FontMetrics fm = labelPaint.getFontMetrics();
                canvas.drawText(label, badge.centerX(), badge.centerY() - (fm.ascent + fm.descent) / 2, labelPaint);
                y += systemHeight;
                if (i + 1 < systems.size()) {
                    canvas.drawLine(0, y + gapHeight / 2f, width, y + gapHeight / 2f, dividerPaint);
                    y += gapHeight;
                }
            }
        } finally { if (pageBitmap != null) pageBitmap.recycle(); }
        return result;
    }

    private int systemTop(int index, int pageHeight, int count, PageSystems detected, boolean useDetection) {
        return useDetection ? detected.top[index] : Math.round(pageHeight * (index / (float) count));
    }

    private int systemBottom(int index, int pageHeight, int count, PageSystems detected, boolean useDetection) {
        return useDetection ? detected.bottom[index] : Math.round(pageHeight * ((index + 1) / (float) count));
    }


    private int currentSystemCount() {
        if (!autoDetection || pageIndex >= pageSystems.size()) return systemsPerPage;
        PageSystems systems = pageSystems.get(pageIndex);
        return systems == null || systems.count() == 0 ? systemsPerPage : systems.count();
    }

    /** Finds five-line staves while compensating for slight scan skew, then combines voices. */
    private PageSystems detectSystems(Bitmap image) {
        int width = image.getWidth(), height = image.getHeight();
        int left = width / 20, right = width * 19 / 20;
        int sampleStep = Math.max(2, (right - left + 399) / 400);
        int sampleColumns = (right - left + sampleStep - 1) / sampleStep;
        int[] pixels = new int[width * height];
        image.getPixels(pixels, 0, width, 0, 0, width, height);
        int darkCount = 0;
        for (int x = left; x < right; x += sampleStep) {
            for (int y = 0, offset = x; y < height; y++, offset += width) {
                int color = pixels[offset];
                int luminance = (Color.red(color) * 299 + Color.green(color) * 587 + Color.blue(color) * 114) / 1000;
                if (luminance < 160) darkCount++;
            }
        }
        int[] darkX = new int[darkCount], darkY = new int[darkCount];
        int point = 0;
        for (int x = left; x < right; x += sampleStep) {
            for (int y = 0, offset = x; y < height; y++, offset += width) {
                int color = pixels[offset];
                int luminance = (Color.red(color) * 299 + Color.green(color) * 587 + Color.blue(color) * 114) / 1000;
                if (luminance < 160) { darkX[point] = x; darkY[point] = y; point++; }
            }
        }
        ArrayList<Staff> staffs = new ArrayList<>();
        float bestSlope = 0;
        for (int step = -12; step <= 12; step++) {
            float slope = step * .003f;
            ArrayList<Staff> candidate = detectStaffsAtSlope(darkX, darkY, width, height, sampleColumns, slope);
            if (candidate.size() > staffs.size()) { staffs = candidate; bestSlope = slope; }
        }
        float coarseBestSlope = bestSlope;
        for (int step = -6; step <= 6; step++) {
            float slope = coarseBestSlope + step * .0005f;
            ArrayList<Staff> candidate = detectStaffsAtSlope(darkX, darkY, width, height, sampleColumns, slope);
            if (candidate.size() > staffs.size()) staffs = candidate;
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
            float typicalGap = gapRatios.get((gapRatios.size() - 1) / 2);
            systemGap = Math.max(6.0f, typicalGap * 1.6f);
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

    private ArrayList<Staff> detectStaffsAtSlope(int[] darkX, int[] darkY, int width, int height,
                                                 int sampleColumns, float slope) {
        int[] votes = new int[height];
        float centerX = width / 2f;
        for (int i = 0; i < darkX.length; i++) {
            int row = Math.round(darkY[i] - slope * (darkX[i] - centerX));
            if (row >= 0 && row < height) votes[row]++;
        }
        ArrayList<Integer> lines = new ArrayList<>();
        int rowStart = -1, lastHit = -1;
        float threshold = sampleColumns * .55f;
        for (int y = 0; y < height; y++) {
            int nearbyVotes = votes[y] + (y > 0 ? votes[y - 1] : 0) + (y + 1 < height ? votes[y + 1] : 0);
            if (nearbyVotes >= threshold) {
                if (rowStart < 0) rowStart = y;
                else if (y > lastHit + 2) {
                    lines.add((rowStart + lastHit) / 2);
                    rowStart = y;
                }
                lastHit = y;
            }
        }
        if (rowStart >= 0) lines.add((rowStart + lastHit) / 2);

        ArrayList<Staff> staffs = new ArrayList<>();
        int maxSpacing = Math.max(8, height / 30);
        for (int i = 0; i + 4 < lines.size();) {
            int a = lines.get(i), b = lines.get(i + 1), c = lines.get(i + 2), d = lines.get(i + 3), e = lines.get(i + 4);
            int spacing = (e - a) / 4;
            boolean regular = spacing >= 3 && spacing <= maxSpacing &&
                    Math.abs((b - a) - spacing) <= spacing * .35f && Math.abs((c - b) - spacing) <= spacing * .35f &&
                    Math.abs((d - c) - spacing) <= spacing * .35f && Math.abs((e - d) - spacing) <= spacing * .35f;
            if (regular) { staffs.add(new Staff(a, e, spacing)); i += 5; }
            else i++;
        }
        return staffs;
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

    private static class SystemRef {
        final int page, index, top, bottom;
        SystemRef(int page, int index, int top, int bottom) {
            this.page = page; this.index = index; this.top = top; this.bottom = bottom;
        }
        int height() { return bottom - top; }
    }

    private void refreshInfo() {
        if (info == null) return;
        int count = currentSystemCount();
        boolean detected = autoDetection && pageIndex < pageSystems.size() && pageSystems.get(pageIndex) != null && pageSystems.get(pageIndex).count() > 0;
        String visible = visibleSystemCount > 1 ? "   •   " + visibleSystemCount + " im Bild" : "";
        String filePosition = folderPdfIndex >= 0 ? "   •   PDF " + (folderPdfIndex + 1) + "/" + folderPdfs.size() : "";
        info.setText(displayName + (renderer == null ? "" : "\nSeite " + (pageIndex + 1) + "/" + renderer.getPageCount() + filePosition + "   •   System " + (systemIndex + 1) + "/" + count + visible + (autoDetection ? (detected ? " Auto" : " Fallback") : " Manuell")));
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) { super.onWindowFocusChanged(hasFocus); if (hasFocus) immersive(); }
    @Override protected void onDestroy() { openRequestId++; uiHandler.removeCallbacks(hideControlsTask); closePdf(); super.onDestroy(); }
}


