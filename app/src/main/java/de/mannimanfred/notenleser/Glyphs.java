package de.mannimanfred.notenleser;

import java.util.HashMap;
import java.util.Map;

/**
 * SMuFL code points and bounding boxes of the bundled Leland music font (from leland_metadata.json).
 * Boxes are in staff spaces with y pointing down, relative to the glyph origin at a font size of 4 staff spaces.
 */
final class Glyphs {
    private Glyphs() { }

    private static final Map<String, Character> BY_NAME = new HashMap<>();
    private static final Map<Character, float[]> BOXES = new HashMap<>();

    static final char G_CLEF = def("gClef", 0xE050, 0, -2.666f, 2.56f, 4.449f);
    static final char G_CLEF_8VB = def("gClef8vb", 0xE052, 0, -3.59f, 2.56f, 4.45f);
    static final char G_CLEF_8VA = def("gClef8va", 0xE053, 0, -2.664f, 2.56f, 5.35f);
    static final char C_CLEF = def("cClef", 0xE05C, 0, -1.92f, 2.508f, 1.928f);
    static final char F_CLEF = def("fClef", 0xE062, 0.001f, -2.468f, 2.656f, 1.004f);
    static final char F_CLEF_8VB = def("fClef8vb", 0xE064, 0.001f, -2.968f, 2.656f, 1.004f);
    static final char PERCUSSION_CLEF = def("unpitchedPercussionClef1", 0xE069, 0, -1.008f, 1.408f, 1.008f);
    static final char NOTEHEAD_DOUBLE_WHOLE = def("noteheadDoubleWhole", 0xE0A0, 0, -0.712f, 2.152f, 0.716f);
    static final char NOTEHEAD_WHOLE = def("noteheadWhole", 0xE0A2, 0, -0.536f, 1.492f, 0.544f);
    static final char NOTEHEAD_HALF = def("noteheadHalf", 0xE0A3, 0, -0.532f, 1.3f, 0.528f);
    static final char NOTEHEAD_BLACK = def("noteheadBlack", 0xE0A4, 0, -0.532f, 1.3f, 0.528f);
    static final char NOTEHEAD_X = def("noteheadXBlack", 0xE0A9, 0, -0.528f, 1.3f, 0.528f);
    static final char[] FLAGS_UP = {
            def("flag8thUp", 0xE240, 0.001f, -3.268f, 1.157f, 0.048f), def("flag16thUp", 0xE242, 0, -3.281f, 1.116f, 0.049f),
            def("flag32ndUp", 0xE244, 0, -3.285f, 1.117f, 0.745f), def("flag64thUp", 0xE246, 0, -3.287f, 1.117f, 1.493f)};
    static final char[] FLAGS_DOWN = {
            def("flag8thDown", 0xE241, 0, -0.048f, 1.235f, 3.268f), def("flag16thDown", 0xE243, 0, -0.104f, 1.235f, 3.213f),
            def("flag32ndDown", 0xE245, 0, -0.863f, 1.235f, 3.214f), def("flag64thDown", 0xE247, 0, -1.61f, 1.235f, 3.214f)};
    static final char FLAT = def("accidentalFlat", 0xE260, 0, -0.704f, 0.812f, 1.812f);
    static final char NATURAL = def("accidentalNatural", 0xE261, 0, -1.292f, 0.684f, 1.3f);
    static final char SHARP = def("accidentalSharp", 0xE262, 0, -1.332f, 0.976f, 1.336f);
    static final char DOUBLE_SHARP = def("accidentalDoubleSharp", 0xE263, 0, -0.548f, 1.1f, 0.552f);
    static final char DOUBLE_FLAT = def("accidentalDoubleFlat", 0xE264, 0, -0.704f, 1.484f, 1.812f);
    static final char REST_DOUBLE_WHOLE = def("restDoubleWhole", 0xE4E2, 0.001f, -0.044f, 0.501f, 1.048f);
    static final char REST_WHOLE = def("restWhole", 0xE4E3, 0, -0.524f, 1.3f, 0.02f);
    static final char REST_HALF = def("restHalf", 0xE4E4, 0, -0.016f, 1.3f, 0.528f);
    static final char REST_QUARTER = def("restQuarter", 0xE4E5, 0, -1.325f, 0.94f, 1.605f);
    static final char REST_8TH = def("rest8th", 0xE4E6, 0, -1.022f, 1.104f, 0.814f);
    static final char REST_16TH = def("rest16th", 0xE4E7, 0.004f, -2.029f, 1.376f, 0.815f);
    static final char REST_32ND = def("rest32nd", 0xE4E8, 0, -2.029f, 1.563f, 1.839f);
    static final char REST_64TH = def("rest64th", 0xE4E9, -0.002f, -3.032f, 1.69f, 1.855f);
    static final char[] TIME_DIGITS = {
            def("timeSig0", 0xE080, 0.06f, -1.016f, 1.556f, 1.02f), def("timeSig1", 0xE081, 0.06f, -0.972f, 1.344f, 0.98f),
            def("timeSig2", 0xE082, 0.06f, -0.972f, 1.508f, 0.98f), def("timeSig3", 0xE083, 0.06f, -0.976f, 1.457f, 0.976f),
            def("timeSig4", 0xE084, 0.055f, -0.992f, 1.768f, 0.996f), def("timeSig5", 0xE085, 0.06f, -0.976f, 1.448f, 0.984f),
            def("timeSig6", 0xE086, 0.06f, -0.976f, 1.548f, 0.98f), def("timeSig7", 0xE087, 0.058f, -1.0f, 1.462f, 1.004f),
            def("timeSig8", 0xE088, 0.06f, -0.992f, 1.572f, 0.984f), def("timeSig9", 0xE089, 0.06f, -0.976f, 1.548f, 0.98f)};
    static final char TIME_COMMON = def("timeSigCommon", 0xE08A, 0, -1.024f, 1.852f, 1.032f);
    static final char TIME_CUT = def("timeSigCutCommon", 0xE08B, 0, -1.504f, 1.852f, 1.552f);
    static final char DOT = def("augmentationDot", 0xE1E7, 0, -0.2f, 0.4f, 0.2f);
    static final char DYNAMIC_P = def("dynamicPiano", 0xE520, -0.38f, -0.652f, 1.268f, 1.052f);
    static final char DYNAMIC_M = def("dynamicMezzo", 0xE521, -0.028f, -0.008f, 1.496f, 1.004f);
    static final char DYNAMIC_F = def("dynamicForte", 0xE522, -0.548f, -0.772f, 1.336f, 1.684f);
    static final char DYNAMIC_R = def("dynamicRinforzando", 0xE523, -0.048f, 0, 0.92f, 1.016f);
    static final char DYNAMIC_S = def("dynamicSforzando", 0xE524, 0, -0.02f, 0.832f, 1.052f);
    static final char DYNAMIC_Z = def("dynamicZ", 0xE525, -0.168f, -0.004f, 0.956f, 1.032f);
    static final char DYNAMIC_N = def("dynamicNiente", 0xE526, -0.048f, -0.004f, 1.02f, 1.016f);
    static final char FERMATA_ABOVE = def("fermataAbove", 0xE4C0, 0, 0, 2.488f, 1.472f);
    static final char FERMATA_BELOW = def("fermataBelow", 0xE4C1, 0, -1.472f, 2.488f, 0);
    static final char SEGNO = def("segno", 0xE047, 0, 0, 2.616f, 3.476f);
    static final char CODA = def("coda", 0xE048, 0, -0.452f, 2.98f, 2.94f);
    static final char REPEAT_DOT = def("repeatDot", 0xE044, 0, -0.212f, 0.416f, 0.212f);
    static final char BREATH = def("breathMarkComma", 0xE4CE, 0, 0.001f, 0.764f, 1.285f);
    static final char BRACE = def("brace", 0xE000, -0.002f, 0.019f, 0.248f, 3.98f);

    static {
        def("articAccentAbove", 0xE4A0, 0, 0, 1.444f, 0.94f); def("articAccentBelow", 0xE4A1, 0, -0.94f, 1.444f, 0);
        def("articStaccatoAbove", 0xE4A2, 0, 0, 0.312f, 0.312f); def("articStaccatoBelow", 0xE4A3, 0, -0.312f, 0.312f, 0);
        def("articTenutoAbove", 0xE4A4, 0, 0, 1.264f, 0.184f); def("articTenutoBelow", 0xE4A5, 0, -0.184f, 1.264f, 0);
        def("articStaccatissimoAbove", 0xE4A6, 0, 0, 0.508f, 0.992f); def("articStaccatissimoBelow", 0xE4A7, 0, -0.992f, 0.507f, 0);
        def("articMarcatoAbove", 0xE4AC, 0.004f, 0, 1.184f, 1.012f); def("articMarcatoBelow", 0xE4AD, 0, -1.012f, 1.18f, 0);
        def("ornamentTrill", 0xE566, -0.048f, 0, 1.532f, 1.532f); def("ornamentTurn", 0xE567, 0, 0, 1.824f, 0.928f);
        def("ornamentShortTrill", 0xE56C, 0, 0, 1.892f, 0.992f); def("ornamentMordent", 0xE56D, 0, -0.308f, 1.892f, 1.264f);
        def("brassMuteClosed", 0xE5E5, 0, 0, 1.248f, 1.248f); def("brassMuteOpen", 0xE5E7, 0, 0, 1.12f, 1.12f);
        def("metNoteWhole", 0xE1D2, -0.001f, -0.688f, 1.899f, 0.688f); def("metNoteHalfUp", 0xE1D3, 0, -0.686f, 1.7f, 3.454f);
        def("metNoteQuarterUp", 0xE1D5, -0.002f, -0.69f, 1.698f, 3.45f); def("metNote8thUp", 0xE1D7, 0, -0.689f, 2.844f, 3.603f);
        def("metAugmentationDot", 0xE1E7, 0, -0.2f, 0.4f, 0.2f);
    }

    private static char def(String name, int codePoint, float swX, float swY, float neX, float neY) {
        char c = (char) codePoint;
        BY_NAME.put(name, c);
        BOXES.put(c, new float[]{swX, -neY, neX, -swY});
        return c;
    }

    static char byName(String name) {
        Character c = BY_NAME.get(name);
        return c == null ? 0 : c;
    }

    /** Glyph box {left, top, right, bottom} at font size 4 staff spaces, or null for unknown characters. */
    static float[] box(char c) { return BOXES.get(c); }

    static float width(char c) {
        float[] box = BOXES.get(c);
        return box == null ? 1f : box[2];
    }

    static boolean isMusic(char c) { return c >= 0xE000 && c <= 0xF8FF; }

    /** Maps a symbol name used inside MuseScore texts to a character for text runs. */
    static char symbolForName(String name) {
        switch (name) {
            case "space": return ' ';
            case "metNote16thUp": return (char) 0xE1D9;
            default: return byName(name);
        }
    }

    static char dynamicLetter(char letter) {
        switch (letter) {
            case 'p': return DYNAMIC_P;
            case 'm': return DYNAMIC_M;
            case 'f': return DYNAMIC_F;
            case 'r': return DYNAMIC_R;
            case 's': return DYNAMIC_S;
            case 'z': return DYNAMIC_Z;
            case 'n': return DYNAMIC_N;
            default: return 0;
        }
    }
}
