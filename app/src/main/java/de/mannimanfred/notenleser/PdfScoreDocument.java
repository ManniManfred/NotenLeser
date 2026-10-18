package de.mannimanfred.notenleser;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.IOException;

/** PDF scores rendered with Android's PdfRenderer from a local copy of the file. */
final class PdfScoreDocument implements ScoreDocument {
    private final File file;
    private final ParcelFileDescriptor descriptor;
    private final PdfRenderer renderer;

    PdfScoreDocument(File file) throws IOException {
        this.file = file;
        descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
        try { renderer = new PdfRenderer(descriptor); }
        catch (IOException | RuntimeException e) { descriptor.close(); throw e; }
    }

    @Override public int getPageCount() { return renderer.getPageCount(); }

    @Override public float pageAspect(int pageIndex) {
        PdfRenderer.Page page = renderer.openPage(pageIndex);
        try { return page.getHeight() / (float) page.getWidth(); }
        finally { page.close(); }
    }

    @Override public Bitmap renderPage(int pageIndex, int width) {
        PdfRenderer.Page page = renderer.openPage(pageIndex);
        try {
            int height = Math.max(1, Math.round(width * page.getHeight() / (float) page.getWidth()));
            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            bitmap.eraseColor(Color.WHITE);
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            return bitmap;
        } finally { page.close(); }
    }

    @Override public float[] systemRatios(int page) { return null; }

    @Override public void close() {
        renderer.close();
        try { descriptor.close(); } catch (IOException ignored) { }
        file.delete();
    }
}
