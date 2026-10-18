package de.mannimanfred.notenleser;

import java.util.ArrayList;
import java.util.List;

/** Format-independent description of an imported score; ticks use {@link Score#division} per quarter. */
final class MusicModel {
    private MusicModel() { }

    static final class Score {
        String title = "", subtitle = "", composer = "", lyricist = "";
        int division = 480;
        /** Page geometry in millimetres; the staff space ("spatium") defines all music sizes. */
        float spatiumMm = 1.75f, pageWidthMm = 210f, pageHeightMm = 297f;
        float marginLeftMm = 15f, marginRightMm = 15f, marginTopMm = 15f, marginBottomMm = 15f;
        final List<Staff> staves = new ArrayList<>();
        final List<Measure> measures = new ArrayList<>();
        final List<Spanner> spanners = new ArrayList<>();
    }

    static final class Staff {
        String name = "", shortName = "";
        int part;
        /** Bracket starting at this staff: 0 = none, 1 = bracket, 2 = brace; span in staves. */
        int bracket, bracketSpan;
        boolean barLineToNext;
        String clef = "G";
    }

    static final class Measure {
        int tick, ticks;
        int timeN = 4, timeD = 4;
        boolean timeChange;
        /** 0 = numeric, 1 = common time, 2 = cut time. */
        int timeSymbol;
        boolean startRepeat, irregular;
        int endRepeat;
        /** End barline: null for a normal one, else "double", "end", "dashed", "dotted", "heavy", "reverse-end". */
        String endBarline;
        boolean lineBreak, pageBreak;
        int number;
        final List<StaffMeasure> staves = new ArrayList<>();
    }

    static final class StaffMeasure {
        /** New key signature in fifths at the start of the measure, or null. */
        Integer key;
        final List<ClefChange> clefs = new ArrayList<>();
        final List<ChordRest> chordRests = new ArrayList<>();
        final List<Annotation> annotations = new ArrayList<>();
    }

    static final class ClefChange {
        final int tick; final String clef;
        ClefChange(int tick, String clef) { this.tick = tick; this.clef = clef; }
    }

    static final class ChordRest {
        int tick, duration, voice;
        /** Notated value: 0 = breve, 1 = whole, 2 = half, 4 = quarter, 8 = eighth, ... */
        int value = 4;
        int dots;
        boolean rest, measureRest, grace, small, visible = true;
        final List<Note> notes = new ArrayList<>();
        /** 1 = stem up, -1 = stem down, 0 = automatic. */
        int stemDirection;
        /** "begin", "mid", "no" or null for automatic beaming. */
        String beamMode;
        /** MuseScore 2 beam id, -1 if absent. */
        int beamId = -1;
        final List<String> articulations = new ArrayList<>();
        String fermata;
        boolean breath;
        final List<Lyric> lyrics = new ArrayList<>();
        Tuplet tuplet;
        final List<ChordRest> graces = new ArrayList<>();
    }

    static final class Note {
        int pitch, tpc;
        boolean tieStart, tieEnd;
        Note tieTo;
        String head;
        /** Accidental glyph requested by the file, e.g. "accidentalSharp". */
        String accidental;
        /** Layout: staff position in half spaces below the top line and the accidental to show (0 for none). */
        int position;
        char shownAccidental;
    }

    static final class Tuplet {
        int actual = 3, normal = 2;
        boolean showNumber = true;
        final List<ChordRest> members = new ArrayList<>();
    }

    static final class Lyric {
        int verse; String text = ""; String syllabic;
    }

    static final class Annotation {
        static final int TEXT_ABOVE = 0, TEXT_BELOW = 1, DYNAMIC = 2, REHEARSAL = 3, TEMPO = 4, SEGNO = 5, CODA = 6, CHORD_SYMBOL = 7;
        final int kind, tick; final String text;
        Annotation(int kind, int tick, String text) { this.kind = kind; this.tick = tick; this.text = text; }
    }

    static final class Spanner {
        static final int SLUR = 0, CRESCENDO = 1, DIMINUENDO = 2, VOLTA = 3;
        int kind, staff, voice, startTick, endTick;
        ChordRest start, end;
        String text = "";
        boolean endHook;
    }
}
