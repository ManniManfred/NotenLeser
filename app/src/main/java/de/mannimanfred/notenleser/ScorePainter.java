package de.mannimanfred.notenleser;

/** Drawing target of {@link ScoreEngraver}; all coordinates are staff spaces with y pointing down. */
interface ScorePainter {
    int BOLD = 1, ITALIC = 2;
    int LEFT = 0, CENTER = 1, RIGHT = 2;

    void line(float x1, float y1, float x2, float y2, float width);

    /** Fills a polygon given as x0, y0, x1, y1, ... */
    void polygon(float[] points);

    /**
     * Fills the band between two cubic curves sharing their end points (x1, y1) and (x2, y2):
     * one through the control points (ax, ay), (bx, by), the other through (cx, cy), (dx, dy).
     */
    void curveBand(float x1, float y1, float ax, float ay, float bx, float by,
                   float cx, float cy, float dx, float dy, float x2, float y2);

    /** Draws a music font glyph; scale 1 is the normal size of four staff spaces per em. */
    void glyph(char glyph, float x, float y, float scale);

    /** Draws text with its baseline at y; music font characters in the text use the music font. */
    void text(String text, float x, float y, float size, int style, int align);

    float textWidth(String text, float size, int style);

    void frame(float left, float top, float right, float bottom, float width);
}
