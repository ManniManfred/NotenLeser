package de.mannimanfred.notenleser;

import android.graphics.Bitmap;

/** A paged score the reader can display, independent of the file format. */
interface ScoreDocument {
    int getPageCount();

    /** Page height divided by page width. */
    float pageAspect(int page);

    /** Renders a page onto a white bitmap of the given pixel width. */
    Bitmap renderPage(int page, int width);

    /**
     * Known system bounds of a page as [top0, bottom0, top1, bottom1, ...] ratios of the page height,
     * or null when the systems have to be detected from the rendered image.
     */
    float[] systemRatios(int page);

    void close();
}
