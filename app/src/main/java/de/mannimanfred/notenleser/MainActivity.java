package de.mannimanfred.notenleser;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Matrix;
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
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private enum PagingMode { SYSTEM, PAGE, VISIBLE_SYSTEMS }

    private static final int PICK_PDF = 41;
    private static final int PICK_FOLDER = 42;
    private Uri pdfUri;
    private ParcelFileDescriptor descriptor;
    private PdfRenderer renderer;
    private File cachedPdf;
    private int pageIndex = 0;
    private int systemIndex = 0;
    private int visibleSystemCount = 1;
    private List<SystemRef> visibleSystems = new ArrayList<>();
    private int openRequestId = 0;
    private int systemsPerPage = 4;
    private boolean autoDetection = true;
    private PagingMode pagingMode = PagingMode.VISIBLE_SYSTEMS;
    private boolean editMode;
    private final List<PageSystems> pageSystems = new ArrayList<>();
    private final List<Uri> folderPdfs = new ArrayList<>();
    private final Map<Integer, float[]> manualPageRatios = new HashMap<>();
    private final Set<Integer> manualPages = new HashSet<>();
    private final ArrayDeque<ManualSnapshot> manualUndoHistory = new ArrayDeque<>();
    private final ExecutorService sidecarExecutor = Executors.newSingleThreadExecutor();
    private int folderPdfIndex = -1;
    private Uri folderTreeUri;
    private final Handler uiHandler = new Handler();
    private final Runnable hideControlsTask = this::hideControls;
    private ImageView scoreView;
    private TextView info;
    private TextView detectionButton;
    private TextView editButton;
    private TextView previousButton;
    private TextView undoButton;
    private TextView clearButton;
    private LinearLayout topOverlay;
    private LinearLayout startPage;
    private String displayName = "Keine Noten geöffnet";
    private float touchY;
    private float touchX;
    private float lastTouchX;
    private float lastTouchY;
    private int selectedManualSystemIndex = -1;
    private int selectedManualPageIndex = -1;
    private boolean touchStartedOnManualSystem;
    private float zoom = 1f;
    private float panX;
    private float panY;
    private boolean multiTouchGesture;
    private final Matrix imageMatrix = new Matrix();
    private ScaleGestureDetector scaleGestureDetector;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();
        buildUi();
        android.content.SharedPreferences preferences = getPreferences(MODE_PRIVATE);
        String savedPagingMode = preferences.getString("paging_mode", null);
        if (savedPagingMode != null) {
            try { pagingMode = PagingMode.valueOf(savedPagingMode); }
            catch (IllegalArgumentException ignored) { pagingMode = PagingMode.VISIBLE_SYSTEMS; }
        } else {
            pagingMode = preferences.getBoolean("advance_visible_systems", true)
                    ? PagingMode.VISIBLE_SYSTEMS : PagingMode.SYSTEM;
        }
        String savedFolder = getPreferences(MODE_PRIVATE).getString("folder_tree", null);
        if (savedFolder != null) {
            Uri tree = Uri.parse(savedFolder);
            folderTreeUri = tree;
            new Thread(() -> loadFolderPdfs(tree), "notenleser-folder-loader").start();
        } else {
            String saved = getPreferences(MODE_PRIVATE).getString("pdf", null);
            if (saved != null) openPdf(Uri.parse(saved));
        }
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
        scoreView = new ImageView(this); scoreView.setBackgroundColor(Color.BLACK); scoreView.setScaleType(ImageView.ScaleType.MATRIX);
        scaleGestureDetector = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override public boolean onScale(ScaleGestureDetector detector) {
                if (scoreView.getDrawable() == null) return false;
                float oldZoom = zoom;
                float newZoom = Math.max(1f, Math.min(5f, oldZoom * detector.getScaleFactor()));
                if (Math.abs(newZoom - oldZoom) < .001f) return true;
                float focusX = detector.getFocusX(), focusY = detector.getFocusY();
                float baseScale = baseImageScale();
                float oldOffsetX = (scoreView.getWidth() - scoreView.getDrawable().getIntrinsicWidth() * baseScale * oldZoom) / 2f;
                float oldOffsetY = (scoreView.getHeight() - scoreView.getDrawable().getIntrinsicHeight() * baseScale * oldZoom) / 2f;
                float imageX = (focusX - oldOffsetX - panX) / (baseScale * oldZoom);
                float imageY = (focusY - oldOffsetY - panY) / (baseScale * oldZoom);
                zoom = newZoom;
                float newOffsetX = (scoreView.getWidth() - scoreView.getDrawable().getIntrinsicWidth() * baseScale * zoom) / 2f;
                float newOffsetY = (scoreView.getHeight() - scoreView.getDrawable().getIntrinsicHeight() * baseScale * zoom) / 2f;
                panX = focusX - newOffsetX - imageX * baseScale * zoom;
                panY = focusY - newOffsetY - imageY * baseScale * zoom;
                if (zoom == 1f) { panX = 0f; panY = 0f; }
                clampImagePan();
                applyImageTransform();
                return true;
            }
        });
        scoreView.setOnTouchListener((v, e) -> {
            scaleGestureDetector.onTouchEvent(e);
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) {
                touchX = lastTouchX = e.getX(); touchY = lastTouchY = e.getY();
                multiTouchGesture = false;
                touchStartedOnManualSystem = editMode && manualSystemAt(touchY) >= 0;
                return true;
            }
            if (e.getActionMasked() == MotionEvent.ACTION_POINTER_DOWN) {
                multiTouchGesture = true;
                return true;
            }
            if (e.getActionMasked() == MotionEvent.ACTION_MOVE) {
                if (e.getPointerCount() > 1) { multiTouchGesture = true; return true; }
                if (editMode && zoom > 1.01f && !touchStartedOnManualSystem && !scaleGestureDetector.isInProgress()) {
                    panX += e.getX() - lastTouchX;
                    panY += e.getY() - lastTouchY;
                    clampImagePan();
                    applyImageTransform();
                }
                lastTouchX = e.getX(); lastTouchY = e.getY();
                return true;
            }
            if (e.getActionMasked() == MotionEvent.ACTION_UP) {
                float dx = e.getX() - touchX, dy = e.getY() - touchY;
                if (editMode) {
                    if (multiTouchGesture || (zoom > 1.01f && !touchStartedOnManualSystem && Math.hypot(dx, dy) > dp(8))) return true;
                    if (Math.abs(dx) < dp(16) && Math.abs(dy) < dp(16)) {
                        int selected = manualSystemAt(touchY);
                        if (selected >= 0) {
                            selectedManualSystemIndex = selected; selectedManualPageIndex = pageIndex;
                            showControls(); renderSystem();
                        }
                        else toggleControls();
                    } else editOrAddManualSystem(touchY, e.getY());
                    return true;
                }
                if (Math.abs(dx) > Math.max(dp(48), v.getWidth() * .12f) && Math.abs(dx) > Math.abs(dy)) {
                    showControls(); if (dx < 0) next(); else previous();
                } else if (Math.abs(dx) < dp(16) && Math.abs(dy) < dp(16)) toggleControls();
                return true;
            }
            if (e.getActionMasked() == MotionEvent.ACTION_CANCEL) { multiTouchGesture = false; return true; }
            return true;
        });
        scoreView.addOnLayoutChangeListener((v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if ((right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) && renderer != null)
                renderSystem();
        });
        root.addView(scoreView, new FrameLayout.LayoutParams(-1, -1));

        startPage = new LinearLayout(this);
        startPage.setOrientation(LinearLayout.VERTICAL);
        startPage.setGravity(Gravity.CENTER);
        startPage.setPadding(dp(28), dp(28), dp(28), dp(28));
        startPage.setBackgroundColor(Color.rgb(20, 24, 29));
        TextView emblem = new TextView(this);
        emblem.setText("♫"); emblem.setTextSize(54); emblem.setTextColor(Color.rgb(221, 190, 116));
        emblem.setGravity(Gravity.CENTER);
        startPage.addView(emblem, new LinearLayout.LayoutParams(-2, -2));
        TextView heading = new TextView(this);
        heading.setText("NotenLeser"); heading.setTextSize(30); heading.setTextColor(Color.WHITE);
        heading.setGravity(Gravity.CENTER); heading.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        LinearLayout.LayoutParams headingParams = new LinearLayout.LayoutParams(-2, -2);
        headingParams.topMargin = dp(8); startPage.addView(heading, headingParams);
        TextView intro = new TextView(this);
        intro.setText("Öffne eine Noten-PDF oder wähle einen Ordner mit mehreren PDFs.");
        intro.setTextSize(16); intro.setTextColor(Color.rgb(190, 197, 205)); intro.setGravity(Gravity.CENTER);
        intro.setMaxWidth(dp(360));
        LinearLayout.LayoutParams introParams = new LinearLayout.LayoutParams(-2, -2);
        introParams.topMargin = dp(10); introParams.bottomMargin = dp(28); startPage.addView(intro, introParams);
        TextView openPdf = button("PDF öffnen", this::pickPdf);
        openPdf.setTextSize(16); openPdf.setBackground(startActionBackground(true));
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(dp(260), dp(54));
        startPage.addView(openPdf, actionParams);
        TextView openFolder = button("Ordner öffnen", this::pickFolder);
        openFolder.setTextSize(16); openFolder.setBackground(startActionBackground(false));
        LinearLayout.LayoutParams folderParams = new LinearLayout.LayoutParams(dp(260), dp(54));
        folderParams.topMargin = dp(12); startPage.addView(openFolder, folderParams);
        FrameLayout.LayoutParams startParams = new FrameLayout.LayoutParams(-1, -1);
        root.addView(startPage, startParams);

        topOverlay = new LinearLayout(this); topOverlay.setOrientation(LinearLayout.VERTICAL);
        topOverlay.setPadding(dp(12), dp(8), dp(12), dp(8)); topOverlay.setBackground(panelBackground());
        info = new TextView(this); info.setTextColor(Color.WHITE); info.setTextSize(14);
        info.setMaxLines(2); info.setEllipsize(android.text.TextUtils.TruncateAt.END);
        info.setMaxWidth(dp(330));
        info.setGravity(Gravity.CENTER_VERTICAL); info.setPadding(dp(4), dp(2), dp(4), dp(6));
        topOverlay.addView(info, new LinearLayout.LayoutParams(-2, -2));
        LinearLayout tools = new LinearLayout(this); tools.setGravity(Gravity.CENTER_VERTICAL);
        TextView open = button("Öffnen", this::chooseSource);
        detectionButton = button("Auto an", this::toggleDetection);
        previousButton = button("‹", this::previous); previousButton.setContentDescription("Zurück");
        TextView next = button("›", this::next); next.setContentDescription("Weiter");
        TextView options = button("⋯", this::showOptions); options.setContentDescription("Optionen");
        editButton = button("Bearb.", this::toggleEditMode);
        undoButton = button("↶", this::undoManualSystem); undoButton.setContentDescription("Ausgewähltes System entfernen");
        clearButton = button("×", this::clearManualSystems); clearButton.setContentDescription("Systeme dieser Seite löschen");
        undoButton.setVisibility(View.GONE); clearButton.setVisibility(View.GONE);
        previousButton.setTextSize(22); next.setTextSize(22);
        previousButton.setPadding(dp(4), dp(10), dp(4), dp(10)); next.setPadding(dp(4), dp(10), dp(4), dp(10));
        addTool(tools, open); addTool(tools, previousButton); addTool(tools, detectionButton); addTool(tools, next); addTool(tools, options);
        addTool(tools, editButton); addTool(tools, undoButton); addTool(tools, clearButton);
        topOverlay.addView(tools, new LinearLayout.LayoutParams(-2, -2));
        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.LEFT);
        topParams.setMargins(dp(10), dp(12), 0, 0);
        root.addView(topOverlay, topParams);

        setContentView(root); refreshInfo(); showControls();
    }

    private GradientDrawable startActionBackground(boolean primary) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(primary ? Color.rgb(174, 132, 57) : Color.rgb(44, 52, 61));
        shape.setCornerRadius(dp(14));
        if (!primary) shape.setStroke(dp(1), Color.rgb(92, 103, 114));
        return shape;
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
        if (renderer == null) { topOverlay.setVisibility(View.GONE); return; }
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

    private void showOptions() {
        String[] labels = {"System einzeln", "Seitenweise", "Alle sichtbaren Systeme"};
        new AlertDialog.Builder(this)
                .setTitle("Optionen")
                .setSingleChoiceItems(labels, pagingMode.ordinal(), (dialog, which) -> {
                    pagingMode = PagingMode.values()[which];
                    getPreferences(MODE_PRIVATE).edit().putString("paging_mode", pagingMode.name()).remove("advance_visible_systems").apply();
                    systemIndex = 0;
                    renderSystem();
                    dialog.dismiss();
                })
                .setNegativeButton("Schließen", null)
                .show();
    }

    private void pickPdf() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/pdf"); i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(i, PICK_PDF);
    }

    private void pickFolder() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(i, PICK_FOLDER);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FOLDER && result == RESULT_OK && data != null && data.getData() != null) {
            Uri tree = data.getData();
            folderTreeUri = tree;
            // Persist read and write separately; takePersistableUriPermission only accepts these flag constants.
            int granted = data.getFlags();
            try {
                if ((granted & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0)
                    getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if ((granted & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0)
                    getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) { }
            getPreferences(MODE_PRIVATE).edit().putString("folder_tree", tree.toString()).remove("pdf").apply();
            folderPdfs.clear(); folderPdfIndex = -1;
            new Thread(() -> loadFolderPdfs(tree), "notenleser-folder-loader").start();
            return;
        }
        if (request == PICK_PDF && result == RESULT_OK && data != null) {
            Uri u = data.getData();
            folderTreeUri = null;
            editMode = false; autoDetection = true;
            detectionButton.setText("Auto an"); editButton.setText("Bearb.");
            undoButton.setVisibility(View.GONE); clearButton.setVisibility(View.GONE);
            try { getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) { }
            folderPdfs.clear(); folderPdfIndex = -1;
            getPreferences(MODE_PRIVATE).edit().remove("folder_tree").apply();
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
            Collections.sort(found, (a, b) -> String.CASE_INSENSITIVE_ORDER.compare(queryDisplayName(a), queryDisplayName(b)));
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                if (found.isEmpty()) {
                    Toast.makeText(this, "In diesem Ordner wurden keine PDFs gefunden", Toast.LENGTH_LONG).show();
                    return;
                }
                folderPdfs.clear(); folderPdfs.addAll(found);
                String savedPdf = getPreferences(MODE_PRIVATE).getString("pdf", null);
                folderPdfIndex = 0;
                if (savedPdf != null) {
                    for (int i = 0; i < folderPdfs.size(); i++) {
                        if (folderPdfs.get(i).toString().equals(savedPdf)) { folderPdfIndex = i; break; }
                    }
                }
                openPdf(folderPdfs.get(folderPdfIndex));
                Toast.makeText(this, found.size() + " PDFs im Ordner gefunden", Toast.LENGTH_SHORT).show();
            });
        } catch (Exception e) {
            String details = describeCause(e);
            runOnUiThread(() -> Toast.makeText(this, "Ordner konnte nicht gelesen werden: " + details, Toast.LENGTH_LONG).show());
        }
    }

    private Uri findSidecar(Uri tree, String sidecarName) {
        if (tree == null) return null;
        try {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor cursor = getContentResolver().query(children,
                    new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME},
                    null, null, null)) {
                if (cursor != null) {
                    int idColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                    int nameColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                    while (cursor.moveToNext()) {
                        if (idColumn >= 0 && nameColumn >= 0 && sidecarName.equals(cursor.getString(nameColumn)))
                            return DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(idColumn));
                    }
                }
            }
        } catch (Exception ignored) { }
        return null;
    }

    private Uri sidecarFolderUri(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    private String sidecarName(Uri pdf) {
        String name = queryDisplayName(pdf);
        int extension = name.lastIndexOf('.');
        if (extension > 0) name = name.substring(0, extension);
        return name + ".systems.json";
    }

    private Map<Integer, float[]> readSystemSidecar(Uri tree, Uri pdf) {
        Map<Integer, float[]> result = new HashMap<>();
        if (tree == null || pdf == null) return result;
        Uri sidecar = findSidecar(tree, sidecarName(pdf));
        if (sidecar == null) return result;
        try (InputStream input = getContentResolver().openInputStream(sidecar)) {
            if (input == null) return result;
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) bytes.write(buffer, 0, read);
            JSONObject root = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            JSONObject pages = root.optJSONObject("pages");
            if (pages == null) return result;
            java.util.Iterator<String> keys = pages.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                int page;
                try { page = Integer.parseInt(key); } catch (NumberFormatException ignored) { continue; }
                JSONArray systems = pages.optJSONArray(key);
                if (page < 0 || systems == null) continue;
                float[] ratios = new float[systems.length() * 2];
                int valid = 0;
                for (int i = 0; i < systems.length(); i++) {
                    JSONArray bounds = systems.optJSONArray(i);
                    if (bounds == null || bounds.length() < 2) continue;
                    float top = (float) bounds.optDouble(0, -1), bottom = (float) bounds.optDouble(1, -1);
                    if (top < 0 || bottom > 1 || bottom - top < .005f) continue;
                    ratios[valid * 2] = top; ratios[valid * 2 + 1] = bottom; valid++;
                }
                if (valid > 0 || systems.length() == 0) result.put(page, java.util.Arrays.copyOf(ratios, valid * 2));
            }
        } catch (Exception ignored) { }
        return result;
    }

    private String describeCause(Throwable error) {
        Throwable cause = error;
        while (cause.getCause() != null && cause.getCause() != cause) cause = cause.getCause();
        String message = cause.getMessage();
        return cause.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private void openPdf(Uri uri) {
        openPdf(uri, false);
    }

    private void openPdf(Uri uri, boolean startAtLastPage) {
        if (uri == null) {
            Toast.makeText(this, "Die Dateiauswahl hat keinen Datei-URI zurückgegeben", Toast.LENGTH_LONG).show();
            return;
        }
        final int requestId = ++openRequestId;
        final Uri sidecarTree = folderTreeUri;
        closePdf();
        Toast.makeText(this, "PDF wird geladen …", Toast.LENGTH_SHORT).show();
        new Thread(() -> loadPdf(uri, requestId, startAtLastPage, sidecarTree), "notenleser-pdf-loader").start();
    }

    private void loadPdf(Uri uri, int requestId, boolean startAtLastPage, Uri sidecarTree) {
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
            final Map<Integer, float[]> loadedSidecar = readSystemSidecar(sidecarTree, uri);
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
                pdfUri = uri; pageIndex = startAtLastPage ? loadedRenderer.getPageCount() - 1 : 0; systemIndex = 0;
                pageSystems.clear();
                for (int i = 0; i < renderer.getPageCount(); i++) pageSystems.add(null);
                manualPageRatios.clear(); manualPageRatios.putAll(loadedSidecar);
                manualPages.clear(); manualPages.addAll(loadedSidecar.keySet());
                manualUndoHistory.clear(); selectedManualSystemIndex = -1; selectedManualPageIndex = -1;
                if (startAtLastPage && autoDetection) {
                    int lastScorePage = findScorePage(pageIndex, -1);
                    if (lastScorePage >= 0) pageIndex = lastScorePage;
                }
                getPreferences(MODE_PRIVATE).edit().putString("pdf", uri.toString()).apply();
                showControls();
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

    private void toggleDetection() {
        if (editMode) {
            Toast.makeText(this, "Zum Beenden erst Bearb. antippen", Toast.LENGTH_SHORT).show();
            return;
        }
        autoDetection = !autoDetection;
        detectionButton.setText(autoDetection ? "Auto an" : "Auto aus");
        systemIndex = 0;
        Toast.makeText(this, autoDetection ? "Automatische Notensystem-Erkennung" : "Seitenweise Ansicht", Toast.LENGTH_SHORT).show();
        renderSystem();
    }

    private void toggleEditMode() {
        if (renderer == null) {
            Toast.makeText(this, "Bitte zuerst eine PDF öffnen", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!editMode && (folderTreeUri == null || !hasFolderWritePermission())) {
            Toast.makeText(this, "Zum Bearbeiten den PDF-Ordner mit Schreibzugriff auswählen", Toast.LENGTH_LONG).show();
            return;
        }
        editMode = !editMode;
        autoDetection = !editMode;
        zoom = 1f; panX = 0f; panY = 0f;
        detectionButton.setText(autoDetection ? "Auto an" : "Auto aus");
        editButton.setText(editMode ? "Fertig" : "Bearb.");
        previousButton.setContentDescription(editMode ? "Letzte Bearbeitung rückgängig machen" : "Zurück zum vorherigen System");
        undoButton.setVisibility(editMode ? View.VISIBLE : View.GONE);
        clearButton.setVisibility(editMode ? View.VISIBLE : View.GONE);
        systemIndex = 0;
        if (editMode) {
            ensureManualPage(pageIndex, Math.max(scoreView.getWidth(), 1200));
            Toast.makeText(this, "Ziehen markiert, verschiebt oder ändert ein System", Toast.LENGTH_LONG).show();
        }
        renderSystem();
    }

    private boolean hasFolderWritePermission() {
        if (folderTreeUri == null) return false;
        for (android.content.UriPermission permission : getContentResolver().getPersistedUriPermissions()) {
            if (folderTreeUri.equals(permission.getUri()) && permission.isWritePermission()) return true;
        }
        return false;
    }

    private void ensureManualPage(int page, int width) {
        if (page < 0 || page >= pageSystems.size() || manualPages.contains(page)) return;
        manualPages.add(page);
        manualPageRatios.put(page, new float[0]);
        pageSystems.set(page, new PageSystems(new int[0], new int[0]));
    }

    private float manualRatioFromScreenY(float y, int pageHeight) {
        float scale = baseImageScale() * zoom;
        float imageTop = (scoreView.getHeight() - pageHeight * scale) / 2f + panY;
        return Math.max(0f, Math.min(1f, (y - imageTop) / (pageHeight * scale)));
    }

    private int manualSystemAt(float screenY) {
        float[] ratios = manualPageRatios.get(pageIndex);
        if (!editMode || ratios == null || scoreView == null || scoreView.getDrawable() == null) return -1;
        int height = pageBitmapHeight(pageIndex, Math.max(scoreView.getWidth(), 1200));
        float ratio = manualRatioFromScreenY(screenY, height);
        for (int i = 0; i + 1 < ratios.length; i += 2)
            if (ratio >= ratios[i] && ratio <= ratios[i + 1]) return i / 2;
        return -1;
    }

    private void editOrAddManualSystem(float startY, float endY) {
        int width = Math.max(scoreView.getWidth(), 1200);
        int pageHeight = pageBitmapHeight(pageIndex, width);
        float scale = baseImageScale() * zoom;
        float imageTop = (scoreView.getHeight() - pageHeight * baseImageScale() * zoom) / 2f + panY;
        float startRatio = manualRatioFromScreenY(startY, pageHeight);
        float endRatio = manualRatioFromScreenY(endY, pageHeight);
        ArrayList<float[]> ranges = manualRanges(pageIndex);
        int existing = -1;
        for (int i = 0; i < ranges.size(); i++) {
            float[] range = ranges.get(i);
            if (startRatio >= range[0] && startRatio <= range[1]) { existing = i; break; }
        }
        if (existing >= 0) {
            pushManualUndoSnapshot(pageIndex);
            float[] range = ranges.get(existing);
            float edgeTolerance = dp(30) / (pageHeight * scale);
            if (Math.abs(startRatio - range[0]) <= edgeTolerance) {
                range[0] = Math.min(endRatio, range[1] - .005f);
            } else if (Math.abs(startRatio - range[1]) <= edgeTolerance) {
                range[1] = Math.min(1f, Math.max(endRatio, range[0] + .005f));
            } else {
                float height = range[1] - range[0];
                float delta = endRatio - startRatio;
                range[0] = Math.max(0f, Math.min(1f - height, range[0] + delta));
                range[1] = range[0] + height;
            }
            float[] edited = range;
            Collections.sort(ranges, (a, b) -> Float.compare(a[0], b[0]));
            selectedManualSystemIndex = ranges.indexOf(edited);
            selectedManualPageIndex = pageIndex;
            setManualRanges(pageIndex, ranges, width);
            saveManualSidecarAsync();
            renderSystem();
            return;
        }
        int top = Math.max(0, Math.min(pageHeight, Math.round((Math.min(startY, endY) - imageTop) / scale)));
        int bottom = Math.max(0, Math.min(pageHeight, Math.round((Math.max(startY, endY) - imageTop) / scale)));
        if (bottom - top < Math.max(dp(18) / scale, pageHeight * .01f)) {
            Toast.makeText(this, "System durch Ziehen von oben nach unten markieren", Toast.LENGTH_SHORT).show();
            return;
        }
        ensureManualPage(pageIndex, width);
        pushManualUndoSnapshot(pageIndex);
        float[] added = new float[]{top / (float) pageHeight, bottom / (float) pageHeight};
        ranges.add(added);
        Collections.sort(ranges, (a, b) -> Float.compare(a[0], b[0]));
        selectedManualSystemIndex = ranges.indexOf(added);
        selectedManualPageIndex = pageIndex;
        setManualRanges(pageIndex, ranges, width);
        saveManualSidecarAsync();
        renderSystem();
    }

    private ArrayList<float[]> manualRanges(int page) {
        ArrayList<float[]> ranges = new ArrayList<>();
        float[] stored = manualPageRatios.get(page);
        if (stored != null) for (int i = 0; i + 1 < stored.length; i += 2)
            ranges.add(new float[]{stored[i], stored[i + 1]});
        return ranges;
    }

    private void setManualRanges(int page, List<float[]> ranges, int width) {
        float[] ratios = new float[ranges.size() * 2];
        for (int i = 0; i < ranges.size(); i++) {
            ratios[i * 2] = ranges.get(i)[0]; ratios[i * 2 + 1] = ranges.get(i)[1];
        }
        manualPages.add(page);
        manualPageRatios.put(page, ratios);
        pageSystems.set(page, pageSystemsFromRatios(page, width, ratios));
    }

    private PageSystems pageSystemsFromRatios(int page, int width, float[] ratios) {
        int pageHeight = pageBitmapHeight(page, width);
        int count = ratios.length / 2;
        int[] top = new int[count], bottom = new int[count];
        for (int i = 0; i < count; i++) {
            top[i] = Math.max(0, Math.min(pageHeight - 1, Math.round(ratios[i * 2] * pageHeight)));
            bottom[i] = Math.max(top[i] + 1, Math.min(pageHeight, Math.round(ratios[i * 2 + 1] * pageHeight)));
        }
        return new PageSystems(top, bottom);
    }

    private void undoManualSystem() {
        ArrayList<float[]> ranges = manualRanges(pageIndex);
        if (ranges.isEmpty()) return;
        int remove = selectedManualPageIndex == pageIndex && selectedManualSystemIndex >= 0 && selectedManualSystemIndex < ranges.size()
                ? selectedManualSystemIndex : ranges.size() - 1;
        pushManualUndoSnapshot(pageIndex);
        ranges.remove(remove);
        selectedManualSystemIndex = -1; selectedManualPageIndex = -1;
        setManualRanges(pageIndex, ranges, Math.max(scoreView.getWidth(), 1200));
        saveManualSidecarAsync();
        renderSystem();
    }

    private void pushManualUndoSnapshot(int page) {
        float[] current = manualPageRatios.get(page);
        manualUndoHistory.addLast(new ManualSnapshot(page, current == null ? new float[0] : current.clone()));
        while (manualUndoHistory.size() > 50) manualUndoHistory.removeFirst();
    }

    private void undoManualEdit() {
        ManualSnapshot snapshot = manualUndoHistory.pollLast();
        if (snapshot == null) {
            Toast.makeText(this, "Keine Bearbeitung zum Rückgängigmachen", Toast.LENGTH_SHORT).show();
            return;
        }
        manualPages.add(snapshot.page);
        manualPageRatios.put(snapshot.page, snapshot.ratios.clone());
        pageSystems.set(snapshot.page, pageSystemsFromRatios(snapshot.page, Math.max(scoreView.getWidth(), 1200), snapshot.ratios));
        if (snapshot.page == pageIndex) { selectedManualSystemIndex = -1; selectedManualPageIndex = -1; }
        saveManualSidecarAsync();
        renderSystem();
    }

    private void clearManualSystems() {
        ensureManualPage(pageIndex, Math.max(scoreView.getWidth(), 1200));
        if (!manualRanges(pageIndex).isEmpty()) pushManualUndoSnapshot(pageIndex);
        setManualRanges(pageIndex, new ArrayList<>(), Math.max(scoreView.getWidth(), 1200));
        selectedManualSystemIndex = -1; selectedManualPageIndex = -1;
        saveManualSidecarAsync();
        renderSystem();
    }

    private void saveManualSidecarAsync() {
        if (folderTreeUri == null || pdfUri == null) return;
        final Uri tree = folderTreeUri;
        final String name = sidecarName(pdfUri);
        final String jsonText;
        try {
            JSONObject root = new JSONObject(); root.put("version", 1); root.put("pdf", queryDisplayName(pdfUri));
            JSONObject pages = new JSONObject();
            ArrayList<Integer> indices = new ArrayList<>(manualPages); Collections.sort(indices);
            for (int page : indices) {
                JSONArray systems = new JSONArray();
                float[] ratios = manualPageRatios.get(page);
                if (ratios != null) for (int i = 0; i + 1 < ratios.length; i += 2) {
                    JSONArray bounds = new JSONArray(); bounds.put(ratios[i]); bounds.put(ratios[i + 1]); systems.put(bounds);
                }
                pages.put(String.valueOf(page), systems);
            }
            root.put("pages", pages);
            jsonText = root.toString(2);
        } catch (JSONException e) {
            Toast.makeText(this, "JSON konnte nicht erstellt werden", Toast.LENGTH_LONG).show();
            return;
        }
        sidecarExecutor.execute(() -> {
            try {
                Uri document = findSidecar(tree, name);
                if (document == null) document = DocumentsContract.createDocument(
                        getContentResolver(), sidecarFolderUri(tree), "application/json", name);
                if (document == null) throw new IOException("Der Nextcloud-Ordner kann keine JSON-Datei anlegen");
                try (OutputStream output = getContentResolver().openOutputStream(document, "wt")) {
                    if (output == null) throw new IOException("Die JSON-Datei kann nicht geschrieben werden");
                    output.write(jsonText.getBytes(StandardCharsets.UTF_8));
                }
                runOnUiThread(() -> Toast.makeText(this, "Systeme in " + name + " gespeichert", Toast.LENGTH_SHORT).show());
            } catch (Exception e) {
                String details = describeCause(e);
                runOnUiThread(() -> Toast.makeText(this, "JSON-Speichern fehlgeschlagen: " + details, Toast.LENGTH_LONG).show());
            }
        });
    }

    private void next() {
        if (renderer == null) { pickPdf(); return; }
        boolean systemPaging = autoDetection && pagingMode != PagingMode.PAGE;
        List<SystemRef> shown = currentVisibleSystems();
        int nextPage;
        if (shown != null) {
            SystemRef next = adjacentSystem(shown.get(shown.size() - 1), 1, Math.max(scoreView.getWidth(), 1200));
            if (next != null) {
                pageIndex = next.page; systemIndex = next.index;
                renderSystem();
                return;
            }
            nextPage = -1;
        } else {
            if (systemPaging && systemIndex + 1 < currentSystemCount()) {
                systemIndex++;
                renderSystem();
                return;
            }
            nextPage = systemPaging ? findScorePage(pageIndex + 1, 1) :
                    (pageIndex + 1 < renderer.getPageCount() ? pageIndex + 1 : -1);
        }
        if (nextPage >= 0) { pageIndex = nextPage; systemIndex = 0; }
        else if (folderPdfIndex >= 0 && folderPdfIndex + 1 < folderPdfs.size()) {
            folderPdfIndex++;
            openPdf(folderPdfs.get(folderPdfIndex));
            return;
        } else Toast.makeText(this, "Ende der Noten", Toast.LENGTH_SHORT).show();
        renderSystem();
    }

    private void previous() {
        if (editMode) { undoManualEdit(); return; }
        if (renderer == null) { pickPdf(); return; }
        boolean systemPaging = autoDetection && pagingMode != PagingMode.PAGE;
        List<SystemRef> shown = currentVisibleSystems();
        int previousPage;
        if (shown != null) {
            int width = Math.max(scoreView.getWidth(), 1200);
            SystemRef previous = adjacentSystem(shown.get(0), -1, width);
            if (previous != null) {
                SystemRef first = screenStartingBefore(previous, width);
                pageIndex = first.page; systemIndex = first.index;
                renderSystem();
                return;
            }
            previousPage = -1;
        } else {
            if (systemPaging && systemIndex > 0) {
                systemIndex--;
                renderSystem();
                return;
            }
            previousPage = systemPaging ? findScorePage(pageIndex - 1, -1) : pageIndex - 1;
        }
        if (previousPage >= 0) { pageIndex = previousPage; systemIndex = systemPaging ? Math.max(0, currentSystemCount() - 1) : 0; }
        else if (folderPdfIndex > 0) {
            folderPdfIndex--;
            openPdf(folderPdfs.get(folderPdfIndex), true);
            return;
        } else Toast.makeText(this, "Anfang der Noten", Toast.LENGTH_SHORT).show();
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
        if (manualPages.contains(pageIndex)) {
            float[] ratios = manualPageRatios.get(pageIndex);
            PageSystems manual = pageSystemsFromRatios(pageIndex, width, ratios == null ? new float[0] : ratios);
            pageSystems.set(pageIndex, manual);
            return manual;
        }
        PageSystems systems = pageSystems.get(pageIndex);
        if (systems != null) return systems;
        Bitmap bitmap = renderPageBitmap(pageIndex, width);
        systems = detectSystems(bitmap);
        bitmap.recycle();
        pageSystems.set(pageIndex, systems);
        return systems;
    }

    private int pageBitmapHeight(int pageIndex, int width) {
        PdfRenderer.Page page = renderer.openPage(pageIndex);
        try { return Math.max(1, Math.round(width * page.getHeight() / (float) page.getWidth())); }
        finally { page.close(); }
    }

    private void drawManualOverlay(Bitmap bitmap, int page) {
        float[] ratios = manualPageRatios.get(page);
        if (ratios == null || ratios.length == 0) return;
        Canvas canvas = new Canvas(bitmap);
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG); fill.setColor(Color.argb(58, 20, 112, 196));
        Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG); edge.setColor(Color.argb(220, 20, 112, 196));
        edge.setStrokeWidth(Math.max(2f, bitmap.getWidth() / 600f)); edge.setStyle(Paint.Style.STROKE);
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG); text.setColor(Color.WHITE);
        text.setTextSize(Math.max(16f, bitmap.getWidth() / 45f));
        text.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        Paint badge = new Paint(Paint.ANTI_ALIAS_FLAG); badge.setColor(Color.argb(210, 20, 112, 196));
        for (int i = 0; i + 1 < ratios.length; i += 2) {
            float top = ratios[i] * bitmap.getHeight(), bottom = ratios[i + 1] * bitmap.getHeight();
            RectF area = new RectF(0, top, bitmap.getWidth(), bottom);
            boolean selected = selectedManualPageIndex == page && selectedManualSystemIndex == i / 2;
            if (selected) {
                fill.setColor(Color.argb(75, 230, 146, 24));
                edge.setColor(Color.argb(240, 230, 146, 24));
                badge.setColor(Color.argb(220, 184, 105, 0));
            } else {
                fill.setColor(Color.argb(58, 20, 112, 196));
                edge.setColor(Color.argb(220, 20, 112, 196));
                badge.setColor(Color.argb(210, 20, 112, 196));
            }
            canvas.drawRect(area, fill); canvas.drawRect(area, edge);
            float baseline = Math.min(bitmap.getHeight() - 4, top + Math.max(22f, bitmap.getWidth() / 35f));
            float badgeWidth = Math.max(bitmap.getWidth() / 30f, text.measureText("System " + (i / 2 + 1)) + 20f);
            RectF label = new RectF(8, top + 5, 8 + badgeWidth, baseline + 6);
            canvas.drawRoundRect(label, 8, 8, badge);
            canvas.drawText("System " + (i / 2 + 1), 16, baseline, text);
        }
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

    private float baseImageScale() {
        if (scoreView == null || scoreView.getDrawable() == null) return 1f;
        int imageWidth = scoreView.getDrawable().getIntrinsicWidth();
        int imageHeight = scoreView.getDrawable().getIntrinsicHeight();
        if (imageWidth < 1 || imageHeight < 1) return 1f;
        return Math.min(scoreView.getWidth() / (float) imageWidth, scoreView.getHeight() / (float) imageHeight);
    }

    private void applyImageTransform() {
        if (scoreView == null || scoreView.getDrawable() == null) return;
        int imageWidth = scoreView.getDrawable().getIntrinsicWidth();
        int imageHeight = scoreView.getDrawable().getIntrinsicHeight();
        float scale = baseImageScale() * (editMode ? zoom : 1f);
        float offsetX = (scoreView.getWidth() - imageWidth * scale) / 2f + (editMode ? panX : 0f);
        float offsetY = (scoreView.getHeight() - imageHeight * scale) / 2f + (editMode ? panY : 0f);
        imageMatrix.setScale(scale, scale);
        imageMatrix.postTranslate(offsetX, offsetY);
        scoreView.setImageMatrix(imageMatrix);
    }

    private void clampImagePan() {
        if (scoreView == null || scoreView.getDrawable() == null || zoom <= 1f) { panX = 0f; panY = 0f; return; }
        float scale = baseImageScale() * zoom;
        float scaledWidth = scoreView.getDrawable().getIntrinsicWidth() * scale;
        float scaledHeight = scoreView.getDrawable().getIntrinsicHeight() * scale;
        float centeredOffsetX = (scoreView.getWidth() - scaledWidth) / 2f;
        float centeredOffsetY = (scoreView.getHeight() - scaledHeight) / 2f;
        float overscroll = dp(64);
        float minX = scoreView.getWidth() - scaledWidth - centeredOffsetX - overscroll;
        float maxX = -centeredOffsetX + overscroll;
        float minY = scoreView.getHeight() - scaledHeight - centeredOffsetY - overscroll;
        float maxY = -centeredOffsetY + overscroll;
        panX = Math.max(minX, Math.min(maxX, panX));
        panY = Math.max(minY, Math.min(maxY, panY));
    }

    private void renderSystem() {
        refreshInfo();
        if (renderer == null || scoreView == null) return;
        if (scoreView.getWidth() < 1 || scoreView.getHeight() < 1) { scoreView.post(this::renderSystem); return; }
        try {
            int width = Math.max(scoreView.getWidth(), 1200);
            if (!autoDetection || pagingMode == PagingMode.PAGE) {
                visibleSystemCount = 1;
                visibleSystems = new ArrayList<>();
                refreshInfo();
                Bitmap page = renderPageBitmap(pageIndex, width);
                if (editMode) drawManualOverlay(page, pageIndex);
                scoreView.setImageBitmap(page);
                applyImageTransform();
                return;
            }
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
            int maxCropHeight = maxCropHeight(width);
            int gapHeight = gapHeight(width);
            int usedHeight = current.height();
            SystemRef previousCursor = current, nextCursor = current;
            boolean canLookBack = true, canLookForward = true;
            // Visible-system paging anchors the current system at the top so the next
            // page starts exactly after the last system shown.
            boolean anchorTop = pagingMode == PagingMode.VISIBLE_SYSTEMS;
            while (true) {
                boolean added = false;
                if (canLookBack && (!anchorTop || !canLookForward)) {
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
                if (!added && !(anchorTop && canLookBack)) break;
            }
            ArrayList<SystemRef> visible = new ArrayList<>();
            for (int i = before.size() - 1; i >= 0; i--) visible.add(before.get(i));
            visible.add(current); visible.addAll(after);
            visibleSystems = visible;
            visibleSystemCount = visible.size();
            refreshInfo();
            Bitmap crop = composeSystems(visible, width, gapHeight);
            scoreView.setImageBitmap(crop);
            applyImageTransform();
        } catch (Exception e) { Toast.makeText(this, "Seite konnte nicht dargestellt werden", Toast.LENGTH_SHORT).show(); }
    }

    private int maxCropHeight(int width) {
        return Math.round(scoreView.getHeight() * (width / (float) scoreView.getWidth()));
    }

    private int gapHeight(int width) {
        return Math.max(4, Math.round(width * dp(7) / (float) scoreView.getWidth()));
    }

    /** Returns the shown systems if they still belong to the current position, otherwise null. */
    private List<SystemRef> currentVisibleSystems() {
        if (!autoDetection || pagingMode != PagingMode.VISIBLE_SYSTEMS || visibleSystems.isEmpty()) return null;
        for (SystemRef system : visibleSystems)
            if (system.page == pageIndex && system.index == systemIndex) return visibleSystems;
        return null;
    }

    /** Finds the earliest system of a screen that ends with the given system. */
    private SystemRef screenStartingBefore(SystemRef last, int width) {
        int maxCropHeight = maxCropHeight(width), gapHeight = gapHeight(width);
        int usedHeight = last.height();
        SystemRef first = last;
        while (true) {
            SystemRef candidate = adjacentSystem(first, -1, width);
            if (candidate == null || usedHeight + gapHeight + candidate.height() > maxCropHeight) return first;
            usedHeight += gapHeight + candidate.height();
            first = candidate;
        }
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

    private PageSystems detectSystems(Bitmap image) {
        int width = image.getWidth(), height = image.getHeight();
        int[] pixels = new int[width * height];
        image.getPixels(pixels, 0, width, 0, 0, width, height);
        SystemDetector.Result result = SystemDetector.detect(pixels, width, height);
        return new PageSystems(result.top, result.bottom);
    }

    private static class PageSystems {
        final int[] top, bottom;
        PageSystems(int[] top, int[] bottom) { this.top = top; this.bottom = bottom; }
        int count() { return top.length; }
    }

    private static class ManualSnapshot {
        final int page;
        final float[] ratios;
        ManualSnapshot(int page, float[] ratios) { this.page = page; this.ratios = ratios; }
    }

    private static class SystemRef {
        final int page, index, top, bottom;
        SystemRef(int page, int index, int top, int bottom) {
            this.page = page; this.index = index; this.top = top; this.bottom = bottom;
        }
        int height() { return bottom - top; }
    }

    private void refreshInfo() {
        if (startPage != null) startPage.setVisibility(renderer == null ? View.VISIBLE : View.GONE);
        if (topOverlay != null && renderer == null) topOverlay.setVisibility(View.GONE);
        if (info == null) return;
        if (!autoDetection || pagingMode == PagingMode.PAGE) {
            String filePosition = folderPdfIndex >= 0 ? "   •   PDF " + (folderPdfIndex + 1) + "/" + folderPdfs.size() : "";
            int markedSystems = manualPageRatios.containsKey(pageIndex) ? manualPageRatios.get(pageIndex).length / 2 : 0;
            String mode = editMode ? "Bearbeiten • " + markedSystems + " Systeme" : "Seitenmodus";
            info.setText(displayName + (renderer == null ? "" : "\nSeite " + (pageIndex + 1) + "/" + renderer.getPageCount() + filePosition + "   •   " + mode));
            return;
        }
        int count = currentSystemCount();
        boolean detected = autoDetection && pageIndex < pageSystems.size() && pageSystems.get(pageIndex) != null && pageSystems.get(pageIndex).count() > 0;
        String visible = visibleSystemCount > 1 ? "   •   " + visibleSystemCount + " im Bild" : "";
        String filePosition = folderPdfIndex >= 0 ? "   •   PDF " + (folderPdfIndex + 1) + "/" + folderPdfs.size() : "";
        info.setText(displayName + (renderer == null ? "" : "\nSeite " + (pageIndex + 1) + "/" + renderer.getPageCount() + filePosition + "   •   System " + (systemIndex + 1) + "/" + count + visible + (autoDetection ? (detected ? " Auto" : " Fallback") : " Manuell")));
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) { super.onWindowFocusChanged(hasFocus); if (hasFocus) immersive(); }
    @Override protected void onDestroy() { openRequestId++; uiHandler.removeCallbacks(hideControlsTask); sidecarExecutor.shutdown(); closePdf(); super.onDestroy(); }
}


