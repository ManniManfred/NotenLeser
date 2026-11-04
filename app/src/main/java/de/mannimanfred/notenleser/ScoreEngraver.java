package de.mannimanfred.notenleser;

import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

import de.mannimanfred.notenleser.MusicModel.Annotation;
import de.mannimanfred.notenleser.MusicModel.ChordRest;
import de.mannimanfred.notenleser.MusicModel.ClefChange;
import de.mannimanfred.notenleser.MusicModel.Lyric;
import de.mannimanfred.notenleser.MusicModel.Measure;
import de.mannimanfred.notenleser.MusicModel.Note;
import de.mannimanfred.notenleser.MusicModel.Score;
import de.mannimanfred.notenleser.MusicModel.Spanner;
import de.mannimanfred.notenleser.MusicModel.Staff;
import de.mannimanfred.notenleser.MusicModel.StaffMeasure;
import de.mannimanfred.notenleser.MusicModel.Tuplet;

/**
 * Lays out a {@link Score} into pages and systems and draws it through a {@link ScorePainter}.
 * The engraving follows MuseScore's default style closely enough for reading from a screen;
 * all lengths are staff spaces.
 */
final class ScoreEngraver {
    private static final float PT = 0.3528f / 1.75f;
    private static final float STAFF_LINE = 0.11f, STEM = 0.12f, LEDGER = 0.16f, BEAM = 0.5f, BEAM_DISTANCE = 0.75f;
    private static final float THIN = 0.18f, THICK = 0.55f, BAR_GAP = 0.37f;
    private static final float TEXT = 10 * PT, TEMPO = 12 * PT, LYRICS = 10 * PT, TITLE = 22 * PT, SUBTITLE = 16 * PT,
            COMPOSER = 12 * PT, NUMBER = 8 * PT, TUPLET = 10 * PT, REHEARSAL = 14 * PT, NAME = 10 * PT, CHORD_SYMBOL = 12 * PT;
    private static final float STAFF_DISTANCE = 6.5f, SYSTEM_DISTANCE = 8.5f, MAX_SYSTEM_DISTANCE = 15f, GRACE = 0.6f;
    private static final int[] SHARP_POSITIONS = {0, 3, -1, 2, 5, 1, 4}, FLAT_POSITIONS = {4, 1, 5, 2, 6, 3, 7};
    private static final int[] SHARP_STEPS = {3, 0, 4, 1, 5, 2, 6}, FLAT_STEPS = {6, 2, 5, 1, 4, 0, 3};

    final float pageWidth, pageHeight;
    private final Score score;
    private final ScorePainter measurer;
    private final float marginLeft, marginRight, marginTop, marginBottom;
    private final int staffCount;
    private final boolean showNames;
    private final String[][] clefAtStart;
    private final int[][] keyAtStart, keyBefore;
    private final boolean[][] keyChanged, clefChanged;
    private MeasureSpacing[] spacing;
    private final List<SystemLayout> systems = new ArrayList<>();
    private final List<PageLayout> pages = new ArrayList<>();
    private final Map<ChordRest, ChordLayout> chordLayouts = new IdentityHashMap<>();
    private final Map<Note, ChordLayout> noteOwners = new IdentityHashMap<>();
    private final Map<Note, Note> tieSources = new IdentityHashMap<>();

    private static final class MeasureSpacing {
        int[] ticks; float[] base, extra; float lead, changes, trail;
        float fixed(boolean systemStart) {
            float sum = lead + (systemStart ? 0 : changes) + trail;
            for (float e : extra) sum += e;
            return sum;
        }
        float stretch() { float sum = 0; for (float b : base) sum += b; return sum; }
    }

    private static final class MeasurePlacement {
        int index; Measure measure; float x, width, changesX; float[] segX; int[] ticks; boolean systemStart;
        float end() { return x + width; }
        float xAt(int tick) {
            if (ticks.length == 0 || tick <= ticks[0]) return segX.length == 0 ? x + 1 : segX[0];
            for (int i = 0; i < ticks.length; i++) {
                if (ticks[i] == tick) return segX[i];
                int nextTick = i + 1 < ticks.length ? ticks[i + 1] : measure.tick + measure.ticks;
                float nextX = i + 1 < ticks.length ? segX[i + 1] : end() - 0.6f;
                if (tick < nextTick) return segX[i] + (nextX - segX[i]) * (tick - ticks[i]) / Math.max(1f, nextTick - ticks[i]);
            }
            return end() - 0.6f;
        }
    }

    private static final class SystemLayout {
        int first, last; float x0, x1, headerEnd; float[] staffY; boolean firstSystem; float top, bottom;
        final List<MeasurePlacement> measures = new ArrayList<>();
        List<List<ChordLayout>> chords;
        List<List<Beam>> beams;
        float[] chordsTop, chordsBottom, lyricBase, dynamicBase, textBase, voltaY;
        MeasurePlacement placement(int tick) {
            for (MeasurePlacement p : measures) if (tick < p.measure.tick + p.measure.ticks) return tick >= p.measure.tick ? p : null;
            return null;
        }
        int startTick() { return measures.get(0).measure.tick; }
        int endTick() { Measure m = measures.get(measures.size() - 1).measure; return m.tick + m.ticks; }
        /** X position of a tick inside the system; ticks at a barline map to the barline. */
        float xAt(int tick, boolean atBarline) {
            for (int i = 0; i < measures.size(); i++) {
                MeasurePlacement p = measures.get(i);
                if (atBarline && tick == p.measure.tick && i > 0) return p.x;
                if (tick < p.measure.tick + p.measure.ticks) return p.xAt(tick);
            }
            return x1;
        }
    }

    private static final class PageLayout {
        final List<SystemLayout> systems = new ArrayList<>();
        final List<Float> y = new ArrayList<>();
        boolean title;
        float titleBottom;
    }

    private static final class ChordLayout {
        ChordRest cr; int staff; SystemLayout system; MeasurePlacement measure;
        float x, noteWidth = 1.3f, scale = 1f; boolean up, hasStem, multiVoice; int flags; Beam beam;
        float stemX, stemStartY, stemEndY, dotX, top, bottom;
        char head, restGlyph; float restY;
        final List<Note> notes = new ArrayList<>();
        float[] noteX, accX;
        final List<float[]> marks = new ArrayList<>();
        float centerX() { return x + noteWidth / 2; }
        float topNoteY() { return notes.get(0).position * 0.5f; }
        float bottomNoteY() { return notes.get(notes.size() - 1).position * 0.5f; }
    }

    private static final class Beam {
        final List<ChordLayout> chords = new ArrayList<>();
        boolean up; float x1, y1, x2, y2;
        float yAt(float x) { return x2 == x1 ? y1 : y1 + (y2 - y1) * (x - x1) / (x2 - x1); }
    }

    ScoreEngraver(Score score, ScorePainter measurer) {
        this.score = score;
        this.measurer = measurer;
        float sp = Math.max(0.5f, score.spatiumMm);
        pageWidth = score.pageWidthMm / sp; pageHeight = score.pageHeightMm / sp;
        marginLeft = score.marginLeftMm / sp; marginRight = score.marginRightMm / sp;
        marginTop = score.marginTopMm / sp; marginBottom = score.marginBottomMm / sp;
        staffCount = score.staves.size();
        int parts = 0;
        for (Staff staff : score.staves) parts = Math.max(parts, staff.part + 1);
        showNames = parts > 1;
        int measures = score.measures.size();
        clefAtStart = new String[measures][staffCount]; keyAtStart = new int[measures][staffCount];
        keyBefore = new int[measures][staffCount]; keyChanged = new boolean[measures][staffCount];
        clefChanged = new boolean[measures][staffCount];
        if (measures == 0 || staffCount == 0) { pages.add(new PageLayout()); return; }
        prepareStates();
        prepareNotes();
        computeSpacing();
        breakSystems();
        for (SystemLayout system : systems) layoutSystem(system);
        paginate();
    }

    int pageCount() { return pages.size(); }

    // ---- preparation ------------------------------------------------------------------------------------------

    private void prepareStates() {
        for (int s = 0; s < staffCount; s++) {
            String clef = score.staves.get(s).clef;
            int key = 0;
            for (int m = 0; m < score.measures.size(); m++) {
                Measure measure = score.measures.get(m);
                StaffMeasure staffMeasure = measure.staves.get(s);
                for (ClefChange change : staffMeasure.clefs) {
                    if (change.tick != measure.tick) continue;
                    if (m > 0 && !change.clef.equals(clef)) clefChanged[m][s] = true;
                    clef = change.clef;
                }
                clefAtStart[m][s] = clef;
                keyBefore[m][s] = key;
                if (staffMeasure.key != null) {
                    keyChanged[m][s] = m > 0 && staffMeasure.key != key;
                    key = staffMeasure.key;
                }
                keyAtStart[m][s] = key;
                for (ClefChange change : staffMeasure.clefs) if (change.tick > measure.tick) clef = change.clef;
            }
        }
    }

    private String clefAt(int measureIndex, int staff, int tick) {
        String clef = clefAtStart[measureIndex][staff];
        for (ClefChange change : score.measures.get(measureIndex).staves.get(staff).clefs) if (change.tick <= tick) clef = change.clef;
        return clef;
    }

    private void prepareNotes() {
        for (int s = 0; s < staffCount; s++) {
            for (int m = 0; m < score.measures.size(); m++) {
                StaffMeasure staffMeasure = score.measures.get(m).staves.get(s);
                int[] keyAlter = new int[7];
                int key = keyAtStart[m][s];
                for (int i = 0; i < Math.min(7, Math.abs(key)); i++) keyAlter[key > 0 ? SHARP_STEPS[i] : FLAT_STEPS[i]] = key > 0 ? 1 : -1;
                Map<Integer, Integer> state = new java.util.HashMap<>();
                List<ChordRest> ordered = new ArrayList<>(staffMeasure.chordRests);
                Collections.sort(ordered, (a, b) -> Integer.compare(a.tick, b.tick));
                for (ChordRest chordRest : ordered) {
                    List<ChordRest> all = new ArrayList<>(chordRest.graces); all.add(chordRest);
                    for (ChordRest item : all) {
                        int topLine = clefTopLine(clefAt(m, s, item.tick));
                        for (Note note : item.notes) {
                            int step = new int[]{3, 0, 4, 1, 5, 2, 6}[Math.floorMod(note.tpc - 13, 7)];
                            int alter = Math.floorDiv(note.tpc - 13, 7);
                            int octave = Math.floorDiv(note.pitch - alter, 12) - 1;
                            int diatonic = octave * 7 + step;
                            note.position = topLine - diatonic;
                            Integer current = state.get(diatonic);
                            int expected = current != null ? current : keyAlter[step];
                            boolean show = alter != expected && !note.tieEnd;
                            if (!note.tieEnd) state.put(diatonic, alter);
                            note.shownAccidental = show ? accidentalGlyph(alter) : note.accidental != null ? Glyphs.byName(note.accidental) : 0;
                            if (note.tieTo != null) tieSources.put(note.tieTo, note);
                        }
                        Collections.sort(item.notes, (a, b) -> Integer.compare(a.position, b.position));
                    }
                }
            }
        }
    }

    private static char accidentalGlyph(int alter) {
        switch (alter) {
            case -2: return Glyphs.DOUBLE_FLAT;
            case -1: return Glyphs.FLAT;
            case 1: return Glyphs.SHARP;
            case 2: return Glyphs.DOUBLE_SHARP;
            default: return Glyphs.NATURAL;
        }
    }

    /** Diatonic number (octave * 7 + step) of the top staff line for a clef. */
    private static int clefTopLine(String clef) {
        switch (clef) {
            case "G8vb": return 31;
            case "G8va": return 45;
            case "G15ma": return 52;
            case "G15mb": return 24;
            case "F": return 26;
            case "F8vb": return 19;
            case "F15mb": return 12;
            case "F8va": return 33;
            case "F3": return 28;
            case "C1": return 36;
            case "C2": return 34;
            case "C3": return 32;
            case "C4": return 30;
            case "C5": return 28;
            default: return 38;
        }
    }

    private static char clefGlyph(String clef) {
        if (clef.startsWith("G")) return clef.contains("vb") || clef.contains("mb") ? Glyphs.G_CLEF_8VB
                : clef.contains("va") || clef.contains("ma") ? Glyphs.G_CLEF_8VA : Glyphs.G_CLEF;
        if (clef.startsWith("F")) return clef.contains("vb") || clef.contains("mb") ? Glyphs.F_CLEF_8VB : Glyphs.F_CLEF;
        if (clef.startsWith("C")) return Glyphs.C_CLEF;
        return clef.startsWith("PERC") ? Glyphs.PERCUSSION_CLEF : Glyphs.G_CLEF;
    }

    /** Staff position (half spaces below the top line) of the clef glyph origin. */
    private static int clefOrigin(String clef) {
        if (clef.startsWith("F")) return clef.equals("F3") ? 4 : 2;
        switch (clef) {
            case "C1": return 8;
            case "C2": return 6;
            case "C3": return 4;
            case "C4": return 2;
            case "C5": return 0;
            default: return clef.startsWith("PERC") ? 4 : 6;
        }
    }

    // ---- horizontal spacing -----------------------------------------------------------------------------------

    private float durationSpace(int ticks) {
        float quarters = Math.max(0.0625f, ticks / (float) score.division);
        return Math.min(9f, Math.max(1.9f, 3.3f * (float) Math.sqrt(quarters)));
    }

    private void computeSpacing() {
        spacing = new MeasureSpacing[score.measures.size()];
        for (int m = 0; m < score.measures.size(); m++) {
            Measure measure = score.measures.get(m);
            TreeSet<Integer> tickSet = new TreeSet<>();
            for (StaffMeasure staffMeasure : measure.staves) {
                for (ChordRest chordRest : staffMeasure.chordRests) tickSet.add(chordRest.tick);
                for (ClefChange change : staffMeasure.clefs) if (change.tick > measure.tick) tickSet.add(change.tick);
            }
            if (tickSet.isEmpty()) tickSet.add(measure.tick);
            MeasureSpacing ms = new MeasureSpacing();
            int n = tickSet.size();
            ms.ticks = new int[n]; ms.base = new float[n]; ms.extra = new float[n];
            int i = 0;
            for (int tick : tickSet) ms.ticks[i++] = tick;
            float[] lyricWidth = new float[n];
            for (i = 0; i < n; i++) {
                int tick = ms.ticks[i];
                int next = i + 1 < n ? ms.ticks[i + 1] : measure.tick + measure.ticks;
                boolean onlyMeasureRests = true, any = false;
                float extra = 0, dots = 0;
                for (int s = 0; s < staffCount; s++) {
                    StaffMeasure staffMeasure = measure.staves.get(s);
                    for (ChordRest chordRest : staffMeasure.chordRests) {
                        if (chordRest.tick != tick) continue;
                        any = true;
                        if (!chordRest.measureRest) onlyMeasureRests = false;
                        int accidentals = 0; boolean seconds = false;
                        for (int k = 0; k < chordRest.notes.size(); k++) {
                            if (chordRest.notes.get(k).shownAccidental != 0) accidentals++;
                            if (k > 0 && chordRest.notes.get(k).position - chordRest.notes.get(k - 1).position == 1) seconds = true;
                        }
                        float e = accidentals == 0 ? 0 : 1.25f + 1.0f * Math.min(2, accidentals - 1);
                        if (seconds) e += 1.0f;
                        e += chordRest.graces.size() * 1.25f + (chordRest.graces.isEmpty() ? 0 : 0.3f);
                        extra = Math.max(extra, e);
                        dots = Math.max(dots, chordRest.dots * 0.55f);
                        for (Lyric lyric : chordRest.lyrics) lyricWidth[i] = Math.max(lyricWidth[i], measurer.textWidth(lyric.text, LYRICS, 0));
                    }
                    for (ClefChange change : staffMeasure.clefs) if (change.tick == tick && tick > measure.tick) extra = Math.max(extra, 2.6f);
                }
                ms.base[i] = onlyMeasureRests && any ? 5.5f : durationSpace(next - tick) + dots;
                ms.extra[i] = extra;
            }
            for (i = 0; i + 1 < n; i++) {
                if (lyricWidth[i] == 0 && lyricWidth[i + 1] == 0) continue;
                float need = (lyricWidth[i] + lyricWidth[i + 1]) / 2 + 0.9f - ms.extra[i + 1];
                ms.base[i] = Math.max(ms.base[i], need);
            }
            if (n > 0 && lyricWidth[n - 1] > 0) ms.base[n - 1] = Math.max(ms.base[n - 1], lyricWidth[n - 1] / 2 + 0.8f);
            ms.lead = 1.2f + (measure.startRepeat ? 1.7f : 0);
            float changes = 0;
            boolean clefChange = false; float keyWidth = 0;
            for (int s = 0; s < staffCount; s++) {
                if (clefChanged[m][s]) clefChange = true;
                if (keyChanged[m][s]) keyWidth = Math.max(keyWidth, keyChangeWidth(keyBefore[m][s], keyAtStart[m][s]));
            }
            if (clefChange) changes += 2.6f;
            if (keyWidth > 0) changes += keyWidth + 0.8f;
            if (measure.timeChange && m > 0) changes += timeWidth(measure) + 0.9f;
            ms.changes = changes;
            ms.trail = measure.endRepeat > 0 ? 1.5f : "end".equals(measure.endBarline) ? 0.4f : 0;
            spacing[m] = ms;
        }
    }

    private static float keyWidth(int key) { return Math.abs(key) * (key > 0 ? 1.0f : 0.95f); }

    private static float keyChangeWidth(int before, int after) {
        return naturalsNeeded(before, after) * 0.8f + keyWidth(after) + (naturalsNeeded(before, after) > 0 && after != 0 ? 0.4f : 0);
    }

    private static int naturalsNeeded(int before, int after) {
        if (before == 0) return 0;
        if (Integer.signum(before) != Integer.signum(after)) return Math.abs(before);
        return Math.max(0, Math.abs(before) - Math.abs(after));
    }

    private float timeWidth(Measure measure) {
        if (measure.timeSymbol == 1 || measure.timeSymbol == 2) return Glyphs.width(Glyphs.TIME_COMMON);
        return Math.max(digitsWidth(String.valueOf(measure.timeN)), digitsWidth(String.valueOf(measure.timeD)));
    }

    private static float digitsWidth(String digits) {
        float width = 0;
        for (char c : digits.toCharArray()) if (c >= '0' && c <= '9') width += Glyphs.width(Glyphs.TIME_DIGITS[c - '0']) - 0.06f;
        return width;
    }

    // ---- systems ----------------------------------------------------------------------------------------------

    private float headerWidth(int measureIndex) {
        float width = 0.75f + 2.6f + 0.8f;
        int maxKey = 0;
        for (int s = 0; s < staffCount; s++) maxKey = Math.max(maxKey, (int) Math.ceil(keyWidth(keyAtStart[measureIndex][s]) * 100));
        if (maxKey > 0) width += maxKey / 100f + 0.7f;
        Measure measure = score.measures.get(measureIndex);
        if (measure.timeChange || measureIndex == 0) width += timeWidth(measure) + 0.8f;
        return width;
    }

    private float nameWidth(boolean first) {
        if (!showNames) return 0;
        float width = 0;
        for (Staff staff : score.staves) width = Math.max(width, measurer.textWidth(first ? staff.name : staff.shortName, NAME, 0));
        return width == 0 ? 0 : width + 1.2f;
    }

    private float bracketWidth() {
        for (Staff staff : score.staves) if (staff.bracket != 0) return 1.3f;
        return staffCount > 1 ? 0.3f : 0;
    }

    private void breakSystems() {
        float contentRight = pageWidth - marginRight;
        int m = 0;
        while (m < score.measures.size()) {
            SystemLayout system = new SystemLayout();
            system.firstSystem = systems.isEmpty();
            float indent = system.firstSystem ? Math.max(5f, nameWidth(true)) : nameWidth(false);
            system.x0 = marginLeft + indent + bracketWidth();
            system.x1 = contentRight;
            system.headerEnd = system.x0 + headerWidth(m);
            float available = system.x1 - system.headerEnd;
            system.first = m;
            float used = 0;
            int last = m;
            for (int j = m; j < score.measures.size(); j++) {
                float width = spacing[j].fixed(j == m) + spacing[j].stretch();
                if (j > m && used + width > available) break;
                used += width; last = j;
                Measure measure = score.measures.get(j);
                if (measure.lineBreak || measure.pageBreak) break;
            }
            system.last = last;
            systems.add(system);
            m = last + 1;
        }
    }

    private void placeMeasures(SystemLayout system) {
        float fixed = 0, stretch = 0;
        for (int m = system.first; m <= system.last; m++) {
            fixed += spacing[m].fixed(m == system.first); stretch += spacing[m].stretch();
        }
        float available = system.x1 - system.headerEnd;
        float factor = stretch <= 0 ? 1 : (available - fixed) / stretch;
        boolean lastSystem = system.last == score.measures.size() - 1;
        if (lastSystem && (fixed + stretch) < available * 0.3f) factor = Math.min(factor, 1f);
        factor = Math.max(0.6f, factor);
        float x = system.headerEnd;
        for (int m = system.first; m <= system.last; m++) {
            MeasureSpacing ms = spacing[m];
            MeasurePlacement placement = new MeasurePlacement();
            placement.index = m; placement.measure = score.measures.get(m); placement.systemStart = m == system.first;
            placement.x = x;
            placement.changesX = x + (placement.measure.startRepeat ? 1.7f : 0) + 0.5f;
            float cursor = x + ms.lead + (placement.systemStart ? 0 : ms.changes);
            placement.ticks = ms.ticks; placement.segX = new float[ms.ticks.length];
            for (int i = 0; i < ms.ticks.length; i++) {
                cursor += ms.extra[i];
                placement.segX[i] = cursor;
                cursor += ms.base[i] * factor;
            }
            cursor += ms.trail;
            placement.width = cursor - x;
            system.measures.add(placement);
            x = cursor;
        }
        system.x1 = Math.max(x, system.headerEnd + 1);
    }

    private void layoutSystem(SystemLayout system) {
        placeMeasures(system);
        system.staffY = new float[staffCount];
        system.chords = new ArrayList<>(); system.beams = new ArrayList<>();
        system.chordsTop = new float[staffCount]; system.chordsBottom = new float[staffCount];
        system.lyricBase = new float[staffCount]; system.dynamicBase = new float[staffCount];
        system.textBase = new float[staffCount]; system.voltaY = new float[staffCount];
        for (int s = 0; s < staffCount; s++) {
            List<ChordLayout> chords = new ArrayList<>();
            List<Beam> beams = new ArrayList<>();
            for (MeasurePlacement placement : system.measures) layoutStaffMeasure(system, placement, s, chords, beams);
            system.chords.add(chords); system.beams.add(beams);
            float top = 0, bottom = 4;
            for (ChordLayout chord : chords) {
                if (!chord.cr.visible) continue;
                top = Math.min(top, chord.top); bottom = Math.max(bottom, chord.bottom);
            }
            system.chordsTop[s] = top; system.chordsBottom[s] = bottom;
            int verses = 0;
            for (ChordLayout chord : chords) for (Lyric lyric : chord.cr.lyrics) verses = Math.max(verses, lyric.verse + 1);
            system.lyricBase[s] = bottom + 2.6f;
            system.dynamicBase[s] = verses > 0 ? system.lyricBase[s] + verses * 2.5f + 1.0f : Math.max(6.6f, bottom + 2.4f);
            boolean volta = false;
            if (s == 0) for (Spanner spanner : score.spanners)
                if (spanner.kind == Spanner.VOLTA && overlaps(system, spanner)) volta = true;
            system.voltaY[s] = Math.min(-1.5f, top - 1.2f) - 1.0f;
            system.textBase[s] = volta ? system.voltaY[s] - 0.9f : Math.min(-1.3f, top - 0.9f);
        }
        float[] above = new float[staffCount], below = new float[staffCount];
        for (int s = 0; s < staffCount; s++) {
            BoundsPainter bounds = new BoundsPainter(measurer);
            drawStaff(bounds, system, s);
            above[s] = Math.max(0, -bounds.minY); below[s] = Math.max(0, bounds.maxY - 4);
        }
        for (int s = 1; s < staffCount; s++)
            system.staffY[s] = system.staffY[s - 1] + 4 + Math.max(STAFF_DISTANCE, below[s - 1] + above[s] + 1.0f);
        BoundsPainter bounds = new BoundsPainter(measurer);
        drawSystem(bounds, system);
        system.top = Math.min(-above[0], bounds.minY);
        system.bottom = Math.max(system.staffY[staffCount - 1] + 4 + below[staffCount - 1], bounds.maxY);
    }

    private static boolean overlaps(SystemLayout system, Spanner spanner) {
        return spanner.startTick < system.endTick() && spanner.endTick > system.startTick();
    }

    // ---- chords -----------------------------------------------------------------------------------------------

    private void layoutStaffMeasure(SystemLayout system, MeasurePlacement placement, int staff, List<ChordLayout> chords, List<Beam> beams) {
        Measure measure = placement.measure;
        StaffMeasure staffMeasure = measure.staves.get(staff);
        boolean[] voices = new boolean[4];
        for (ChordRest chordRest : staffMeasure.chordRests) if (chordRest.visible || !chordRest.rest) voices[Math.min(3, chordRest.voice)] = true;
        int voiceCount = 0;
        for (boolean voice : voices) if (voice) voiceCount++;
        boolean multiVoice = voiceCount > 1;
        List<ChordLayout> measureChords = new ArrayList<>();
        for (ChordRest chordRest : staffMeasure.chordRests) {
            ChordLayout chord = new ChordLayout();
            chord.cr = chordRest; chord.staff = staff; chord.system = system; chord.measure = placement;
            chord.multiVoice = multiVoice;
            chord.x = placement.xAt(chordRest.tick);
            chord.scale = chordRest.small ? 0.7f : 1f;
            chordLayouts.put(chordRest, chord);
            for (Note note : chordRest.notes) noteOwners.put(note, chord);
            if (chordRest.rest) layoutRest(chord, placement);
            else {
                chord.notes.addAll(chordRest.notes);
                chord.head = chordRest.value == 0 ? Glyphs.NOTEHEAD_DOUBLE_WHOLE : chordRest.value == 1 ? Glyphs.NOTEHEAD_WHOLE
                        : chordRest.value == 2 ? Glyphs.NOTEHEAD_HALF : Glyphs.NOTEHEAD_BLACK;
                if (!chord.notes.isEmpty() && "cross".equals(chord.notes.get(0).head)) chord.head = Glyphs.NOTEHEAD_X;
                chord.noteWidth = Glyphs.width(chord.head) * chord.scale;
                chord.hasStem = chordRest.value >= 2;
                chord.flags = chordRest.value >= 8 ? Math.min(4, Integer.numberOfTrailingZeros(chordRest.value) - 2) : 0;
                if (chordRest.stemDirection != 0) chord.up = chordRest.stemDirection > 0;
                else if (multiVoice) chord.up = chordRest.voice % 2 == 0;
                else chord.up = (chord.bottomNoteY() - 2) > (2 - chord.topNoteY());
            }
            measureChords.add(chord);
        }
        // Voices meeting at a second are shifted apart, the lower voice to the right.
        for (ChordLayout lower : measureChords) {
            if (lower.cr.rest || lower.cr.voice % 2 == 0) continue;
            for (ChordLayout upper : measureChords) {
                if (upper == lower || upper.cr.rest || upper.cr.tick != lower.cr.tick || upper.cr.voice % 2 != 0) continue;
                boolean clash = false;
                for (Note a : upper.notes) for (Note b : lower.notes) {
                    int distance = Math.abs(a.position - b.position);
                    if (distance == 1 || (distance == 0 && (upper.head != lower.head || upper.cr.dots != lower.cr.dots))) clash = true;
                }
                if (clash) lower.x += upper.noteWidth;
            }
        }
        for (int voice = 0; voice < 4; voice++) buildBeams(measure, measureChords, voice, beams);
        for (ChordLayout chord : measureChords) if (!chord.cr.rest) placeNotes(chord);
        for (Beam beam : beams) if (!beam.chords.isEmpty() && beam.chords.get(0).measure == placement) placeBeam(beam);
        for (ChordLayout chord : measureChords) if (!chord.cr.rest && chord.beam == null) placeStem(chord);
        for (ChordLayout chord : measureChords) finishChord(chord);
        chords.addAll(measureChords);
    }

    private void layoutRest(ChordLayout chord, MeasurePlacement placement) {
        ChordRest rest = chord.cr;
        int value = rest.measureRest ? (placement.measure.ticks >= score.division * 8 ? 0 : 1) : rest.value;
        switch (value) {
            case 0: chord.restGlyph = Glyphs.REST_DOUBLE_WHOLE; break;
            case 1: chord.restGlyph = Glyphs.REST_WHOLE; break;
            case 2: chord.restGlyph = Glyphs.REST_HALF; break;
            case 4: chord.restGlyph = Glyphs.REST_QUARTER; break;
            case 8: chord.restGlyph = Glyphs.REST_8TH; break;
            case 16: chord.restGlyph = Glyphs.REST_16TH; break;
            case 32: chord.restGlyph = Glyphs.REST_32ND; break;
            default: chord.restGlyph = Glyphs.REST_64TH;
        }
        float offset = chord.multiVoice ? (rest.voice % 2 == 0 ? -2f : 2f) : 0;
        chord.restY = (value == 1 ? 1f : value == 0 ? 1f : 2f) + offset;
        if (value == 1 && chord.multiVoice) chord.restY = rest.voice % 2 == 0 ? 0f : 3f;
        chord.noteWidth = Glyphs.width(chord.restGlyph);
        if (rest.measureRest) {
            float start = placement.x + (placement.measure.startRepeat ? 1.7f : 0)
                    + (placement.systemStart ? 0 : spacing[placement.index].changes);
            chord.x = (start + placement.end()) / 2 - chord.noteWidth / 2;
        }
        float[] box = Glyphs.box(chord.restGlyph);
        chord.top = chord.restY + box[1]; chord.bottom = chord.restY + box[3];
        chord.dotX = chord.x + chord.noteWidth + 0.35f;
    }

    private void buildBeams(Measure measure, List<ChordLayout> chords, int voice, List<Beam> beams) {
        List<ChordLayout> list = new ArrayList<>();
        for (ChordLayout chord : chords) if (chord.cr.voice == voice) list.add(chord);
        Collections.sort(list, (a, b) -> Integer.compare(a.cr.tick, b.cr.tick));
        Beam current = null;
        int currentGroup = Integer.MIN_VALUE;
        for (ChordLayout chord : list) {
            ChordRest cr = chord.cr;
            boolean beamable = !cr.rest && cr.value >= 8 && !"no".equals(cr.beamMode);
            if (!beamable) {
                if (cr.rest && current != null && "mid".equals(cr.beamMode)) continue;
                current = closeBeam(current, beams); currentGroup = Integer.MIN_VALUE;
                continue;
            }
            // MuseScore 2 stores explicit beams with an id; everything else is beamed automatically.
            int group = cr.beamId >= 0 ? 2_000_000 + cr.beamId : beamGroup(measure, cr);
            boolean join = current != null && ("mid".equals(cr.beamMode) || (!"begin".equals(cr.beamMode) && group == currentGroup));
            if (!join) { current = closeBeam(current, beams); current = new Beam(); }
            current.chords.add(chord);
            currentGroup = group;
        }
        closeBeam(current, beams);
    }

    private Beam closeBeam(Beam beam, List<Beam> beams) {
        if (beam == null) return null;
        if (beam.chords.size() > 1) {
            beams.add(beam);
            ChordLayout forced = null;
            for (ChordLayout chord : beam.chords) if (chord.cr.stemDirection != 0) { forced = chord; break; }
            if (forced != null) beam.up = forced.cr.stemDirection > 0;
            else if (beam.chords.get(0).multiVoice) beam.up = beam.chords.get(0).cr.voice % 2 == 0;
            else {
                float highest = Float.MAX_VALUE, lowest = -Float.MAX_VALUE;
                for (ChordLayout chord : beam.chords) { highest = Math.min(highest, chord.topNoteY()); lowest = Math.max(lowest, chord.bottomNoteY()); }
                beam.up = (lowest - 2) > (2 - highest);
            }
            for (ChordLayout chord : beam.chords) { chord.beam = beam; chord.up = beam.up; }
        }
        return null;
    }

    /** Beat group for automatic beaming, following MuseScore's default beam groups. */
    private int beamGroup(Measure measure, ChordRest cr) {
        if (cr.tuplet != null) return 1_000_000 + System.identityHashCode(cr.tuplet) % 1_000_000;
        int offset = cr.tick - measure.tick;
        int quarter = score.division;
        int group;
        if (measure.timeD == 8 && measure.timeN % 3 == 0) group = quarter * 3 / 2;
        else if (measure.timeD == 8) group = Math.max(quarter / 2, measure.ticks);
        else if (measure.timeD == 2) group = cr.value <= 8 ? quarter * 2 : quarter;
        else if (measure.timeD == 4 && (measure.timeN == 4 || measure.timeN == 2) && cr.value <= 8) group = quarter * 2;
        else group = quarter * 4 / Math.max(1, measure.timeD);
        if (cr.value > 8) group = Math.min(group, measure.timeD == 8 && measure.timeN % 3 == 0 ? quarter * 3 / 2 : quarter);
        return offset / Math.max(1, group);
    }

    private void placeNotes(ChordLayout chord) {
        int n = chord.notes.size();
        chord.noteX = new float[n]; chord.accX = new float[n];
        float base = chord.x;
        if (chord.up) {
            int previous = Integer.MIN_VALUE; boolean previousShifted = false;
            for (int i = n - 1; i >= 0; i--) {
                int position = chord.notes.get(i).position;
                boolean shift = previous - position == 1 && !previousShifted;
                chord.noteX[i] = base + (shift ? chord.noteWidth : 0);
                previousShifted = shift; previous = position;
            }
        } else {
            int previous = Integer.MIN_VALUE; boolean previousShifted = false;
            for (int i = 0; i < n; i++) {
                int position = chord.notes.get(i).position;
                boolean shift = previous != Integer.MIN_VALUE && position - previous == 1 && !previousShifted;
                chord.noteX[i] = base - (shift ? chord.noteWidth : 0);
                previousShifted = shift; previous = position;
            }
        }
        float left = Float.MAX_VALUE, right = -Float.MAX_VALUE;
        for (float x : chord.noteX) { left = Math.min(left, x); right = Math.max(right, x + chord.noteWidth); }
        // Accidentals stack leftwards in columns whenever they would collide vertically.
        List<float[]> placed = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            char accidental = chord.notes.get(i).shownAccidental;
            if (accidental == 0) continue;
            float width = Glyphs.width(accidental) * chord.scale;
            float y = chord.notes.get(i).position * 0.5f;
            float x = left - 0.2f - width;
            boolean moved = true;
            while (moved) {
                moved = false;
                for (float[] other : placed) {
                    if (Math.abs(other[1] - y) < 2.5f && x < other[0] + other[2] && x + width > other[0]) { x = other[0] - 0.15f - width; moved = true; }
                }
            }
            chord.accX[i] = x;
            placed.add(new float[]{x, y, width});
        }
        chord.dotX = right + 0.35f;
        chord.stemX = chord.up ? base + chord.noteWidth - STEM / 2 : base + STEM / 2;
        chord.stemStartY = chord.up ? chord.bottomNoteY() - 0.16f : chord.topNoteY() + 0.17f;
    }

    private void placeStem(ChordLayout chord) {
        if (!chord.hasStem) { chord.stemEndY = chord.up ? chord.topNoteY() : chord.bottomNoteY(); return; }
        float length = 3.5f + Math.max(0, chord.flags - 2) * 0.5f;
        if (chord.up) {
            float end = chord.topNoteY() - length * chord.scale;
            if (end > 2 && !chord.multiVoice) end = 2;
            chord.stemEndY = end;
        } else {
            float end = chord.bottomNoteY() + length * chord.scale;
            if (end < 2 && !chord.multiVoice) end = 2;
            chord.stemEndY = end;
        }
    }

    private void placeBeam(Beam beam) {
        ChordLayout first = beam.chords.get(0), last = beam.chords.get(beam.chords.size() - 1);
        int levels = 1;
        for (ChordLayout chord : beam.chords) levels = Math.max(levels, chord.flags);
        float minLength = 2.75f + (levels - 1) * BEAM_DISTANCE;
        beam.x1 = first.stemX; beam.x2 = last.stemX;
        float y1 = beam.up ? first.topNoteY() - 3.5f : first.bottomNoteY() + 3.5f;
        float y2 = beam.up ? last.topNoteY() - 3.5f : last.bottomNoteY() + 3.5f;
        float maxSlope = Math.min(1.0f, Math.max(0.25f, (beam.x2 - beam.x1) * 0.12f));
        float dy = Math.max(-maxSlope, Math.min(maxSlope, y2 - y1));
        boolean concave = false;
        for (int i = 1; i + 1 < beam.chords.size(); i++) {
            ChordLayout chord = beam.chords.get(i);
            float y = beam.up ? chord.topNoteY() : chord.bottomNoteY();
            float a = beam.up ? first.topNoteY() : first.bottomNoteY(), b = beam.up ? last.topNoteY() : last.bottomNoteY();
            if (beam.up ? y < Math.min(a, b) : y > Math.max(a, b)) concave = true;
        }
        if (concave || first.notes.get(0).position == last.notes.get(0).position) dy = 0;
        beam.y1 = y1; beam.y2 = y1 + dy;
        float violation = -Float.MAX_VALUE;
        for (ChordLayout chord : beam.chords) {
            float y = beam.yAt(chord.stemX);
            if (beam.up) {
                float limit = chord.topNoteY() - minLength;
                if (chord.topNoteY() - 3.5f > 2 && !chord.multiVoice) limit = Math.min(limit, 2);
                violation = Math.max(violation, y - limit);
            } else {
                float limit = chord.bottomNoteY() + minLength;
                if (chord.bottomNoteY() + 3.5f < 2 && !chord.multiVoice) limit = Math.max(limit, 2);
                violation = Math.max(violation, limit - y);
            }
        }
        if (violation > 0 || violation < -0.01f) {
            // Bring the beam as close to the notes as the shortest stem allows.
            float shift = beam.up ? -violation : violation;
            beam.y1 += shift; beam.y2 += shift;
        }
        for (ChordLayout chord : beam.chords) chord.stemEndY = beam.yAt(chord.stemX);
    }

    private void finishChord(ChordLayout chord) {
        if (chord.cr.rest) return;
        float top = chord.topNoteY() - 0.6f, bottom = chord.bottomNoteY() + 0.6f;
        if (chord.hasStem) {
            if (chord.up) top = Math.min(top, chord.stemEndY - (chord.beam != null ? 0 : 0.2f));
            else bottom = Math.max(bottom, chord.stemEndY + (chord.beam != null ? 0 : 0.2f));
        }
        for (int i = 0; i < chord.notes.size(); i++) {
            if (chord.notes.get(i).shownAccidental == 0) continue;
            float y = chord.notes.get(i).position * 0.5f;
            top = Math.min(top, y - 1.4f); bottom = Math.max(bottom, y + 1.4f);
        }
        // Articulations: staccato/tenuto/accent go to the notehead side, others above the staff.
        float aboveY = Math.min(top, chord.topNoteY() - 0.5f), belowY = Math.max(bottom, chord.bottomNoteY() + 0.5f);
        float noteSideAbove = chord.topNoteY() - 0.7f, noteSideBelow = chord.bottomNoteY() + 0.7f;
        for (String articulation : chord.cr.articulations) {
            boolean ornament = articulation.startsWith("ornament") || articulation.startsWith("brass") || articulation.startsWith("articMarcato");
            boolean above = ornament || !chord.up || chord.multiVoice && chord.cr.voice % 2 == 0;
            if (chord.multiVoice && chord.cr.voice % 2 == 1 && !ornament) above = false;
            List<String> parts = new ArrayList<>();
            if (articulation.endsWith("Staccato") && !articulation.equals("articStaccato")) {
                parts.add("articStaccato"); parts.add(articulation.substring(0, articulation.length() - "Staccato".length()));
            } else parts.add(articulation);
            for (String part : parts) {
                char glyph = Glyphs.byName(part.startsWith("artic") ? part + (above ? "Above" : "Below") : part);
                if (glyph == 0) continue;
                float[] box = Glyphs.box(glyph);
                float height = box[3] - box[1], width = box[2] - box[0];
                float y;
                if (ornament) {
                    y = Math.min(-0.6f, Math.min(aboveY, noteSideAbove) - 0.4f);
                    aboveY = y - height; noteSideAbove = aboveY;
                } else if (above) {
                    float center = noteSideAbove - height / 2 - (chord.up && chord.hasStem ? 0 : 0.2f);
                    if (!chord.up && chord.hasStem) center = Math.min(center, chord.topNoteY() - 0.9f);
                    if (center > -0.2f && center < 4.2f && Math.abs(center - Math.round(center)) < 0.3f) center -= 0.5f;
                    y = center + height / 2;
                    noteSideAbove = center - height / 2 - 0.25f;
                    aboveY = Math.min(aboveY, noteSideAbove);
                } else {
                    float center = noteSideBelow + height / 2;
                    if (center > -0.2f && center < 4.2f && Math.abs(center - Math.round(center)) < 0.3f) center += 0.5f;
                    y = center - height / 2;
                    noteSideBelow = center + height / 2 + 0.25f;
                    belowY = Math.max(belowY, noteSideBelow);
                }
                chord.marks.add(new float[]{glyph, chord.centerX() - width / 2 - box[0], y, 1f});
            }
        }
        top = Math.min(top, aboveY); bottom = Math.max(bottom, belowY);
        if (chord.cr.fermata != null) {
            boolean below = chord.cr.fermata.contains("Below");
            char glyph = below ? Glyphs.FERMATA_BELOW : Glyphs.FERMATA_ABOVE;
            float width = Glyphs.width(glyph);
            float y = below ? Math.max(4.6f, bottom + 0.4f) : Math.min(-0.5f, top - 0.4f);
            chord.marks.add(new float[]{glyph, chord.centerX() - width / 2, y, 1f});
            if (below) bottom = y + 1.5f; else top = y - 1.5f;
        }
        if (chord.cr.breath) chord.marks.add(new float[]{Glyphs.BREATH, chord.x + chord.noteWidth + 0.9f + chord.cr.dots * 0.5f, -0.4f, 1f});
        chord.top = top; chord.bottom = bottom;
    }

    // ---- pages ------------------------------------------------------------------------------------------------

    private void paginate() {
        float usableBottom = pageHeight - marginBottom;
        PageLayout page = new PageLayout();
        float y = marginTop;
        boolean hasTitle = !(score.title + score.subtitle + score.composer + score.lyricist).trim().isEmpty();
        if (hasTitle) {
            page.title = true;
            float cursor = marginTop;
            if (!score.title.isEmpty()) cursor += TITLE * 1.1f;
            if (!score.subtitle.isEmpty()) cursor += SUBTITLE * 1.4f;
            if (!score.composer.isEmpty() || !score.lyricist.isEmpty()) cursor += COMPOSER * 1.8f;
            page.titleBottom = cursor;
            y = cursor + 2f;
        }
        pages.add(page);
        SystemLayout previous = null;
        for (SystemLayout system : systems) {
            float staffTop;
            if (previous == null || page.systems.isEmpty()) staffTop = y - system.top;
            else {
                float previousStaffTop = page.y.get(page.y.size() - 1);
                float previousBottomLine = previousStaffTop + previous.staffY[staffCount - 1] + 4;
                float distance = Math.max(SYSTEM_DISTANCE, (previousStaffTop + previous.bottom) - previousBottomLine + (-system.top) + 1.5f);
                staffTop = previousBottomLine + distance;
            }
            boolean pageBreak = previous != null && score.measures.get(previous.last).pageBreak;
            if (!page.systems.isEmpty() && (pageBreak || staffTop + system.bottom > usableBottom)) {
                page = new PageLayout();
                pages.add(page);
                staffTop = marginTop - system.top;
            }
            page.systems.add(system); page.y.add(staffTop);
            previous = system;
        }
        // Spread the systems of full pages over the page height like MuseScore does.
        for (int p = 0; p + 1 < pages.size(); p++) {
            PageLayout layout = pages.get(p);
            int n = layout.systems.size();
            if (n < 2) continue;
            SystemLayout lastSystem = layout.systems.get(n - 1);
            float free = usableBottom - (layout.y.get(n - 1) + lastSystem.bottom);
            if (free <= 0) continue;
            float add = free / (n - 1);
            for (int i = 1; i < n; i++) {
                SystemLayout above = layout.systems.get(i - 1);
                float gap = layout.y.get(i) - (layout.y.get(i - 1) + above.staffY[staffCount - 1] + 4);
                float extra = Math.max(0, Math.min(add, MAX_SYSTEM_DISTANCE - gap));
                for (int j = i; j < n; j++) layout.y.set(j, layout.y.get(j) + extra);
            }
        }
    }

    /** Top and bottom staff line of every staff on a page as ratios of the page height, as top0, bottom0, ... */
    float[] staffRatios(int pageIndex) {
        PageLayout page = pages.get(pageIndex);
        float[] ratios = new float[page.systems.size() * staffCount * 2];
        int n = 0;
        for (int i = 0; i < page.systems.size(); i++) {
            SystemLayout system = page.systems.get(i);
            float y = page.y.get(i);
            for (int s = 0; s < staffCount; s++) {
                ratios[n++] = (y + system.staffY[s]) / pageHeight;
                ratios[n++] = (y + system.staffY[s] + 4) / pageHeight;
            }
        }
        return ratios;
    }

    /** System bounds of a page as ratios of the page height, as top0, bottom0, top1, bottom1, ... */
    float[] systemRatios(int pageIndex) {
        PageLayout page = pages.get(pageIndex);
        int n = page.systems.size();
        float[] ratios = new float[n * 2];
        for (int i = 0; i < n; i++) {
            SystemLayout system = page.systems.get(i);
            float y = page.y.get(i);
            ratios[i * 2] = Math.max(0, (y + system.top - 1.0f) / pageHeight);
            ratios[i * 2 + 1] = Math.min(1, (y + system.bottom + 1.0f) / pageHeight);
        }
        for (int i = 1; i < n; i++) {
            if (ratios[i * 2] < ratios[i * 2 - 1]) {
                float middle = (ratios[i * 2] + ratios[i * 2 - 1]) / 2;
                ratios[i * 2 - 1] = middle; ratios[i * 2] = middle;
            }
        }
        return ratios;
    }

    /**
     * Playback cursor for a tick as {page, system index on the page, x, measure left, measure right, top, bottom};
     * x values are ratios of the page width, top and bottom ratios of the page height. Null outside the score.
     */
    float[] cursorAt(int tick) {
        for (int p = 0; p < pages.size(); p++) {
            PageLayout page = pages.get(p);
            for (int i = 0; i < page.systems.size(); i++) {
                SystemLayout system = page.systems.get(i);
                if (tick < system.startTick() || tick >= system.endTick()) continue;
                MeasurePlacement placement = system.placement(tick);
                float y = page.y.get(i);
                float top = y + system.staffY[0] - 1.5f, bottom = y + system.staffY[staffCount - 1] + 5.5f;
                float x = system.xAt(tick, false);
                float left = placement == null ? x : placement.x, right = placement == null ? x : placement.end();
                return new float[]{p, i, x / pageWidth, left / pageWidth, right / pageWidth,
                        Math.max(0, top / pageHeight), Math.min(1, bottom / pageHeight)};
            }
        }
        return null;
    }

    /**
     * Index of the measure at a point of a page (ratios of page width and height), or -1 when the page has no
     * systems. Points beside a system pick its nearest measure, points between systems the nearest system.
     */
    int measureAt(int pageIndex, float xRatio, float yRatio) {
        if (pageIndex < 0 || pageIndex >= pages.size()) return -1;
        PageLayout page = pages.get(pageIndex);
        float x = xRatio * pageWidth, y = yRatio * pageHeight;
        SystemLayout best = null;
        float bestDistance = Float.MAX_VALUE;
        for (int i = 0; i < page.systems.size(); i++) {
            SystemLayout system = page.systems.get(i);
            float top = page.y.get(i) + system.staffY[0], bottom = page.y.get(i) + system.staffY[staffCount - 1] + 4;
            float distance = y < top ? top - y : y > bottom ? y - bottom : 0;
            if (distance < bestDistance) { bestDistance = distance; best = system; }
        }
        if (best == null || best.measures.isEmpty()) return -1;
        for (MeasurePlacement placement : best.measures) if (x < placement.end()) return placement.index;
        return best.measures.get(best.measures.size() - 1).index;
    }

    /**
     * Areas of the measures first..last on a page, one per system, as {system index, left, right, top, bottom};
     * values are ratios like in {@link #cursorAt}.
     */
    List<float[]> measureBoxes(int pageIndex, int first, int last) {
        List<float[]> boxes = new ArrayList<>();
        if (pageIndex < 0 || pageIndex >= pages.size()) return boxes;
        PageLayout page = pages.get(pageIndex);
        for (int i = 0; i < page.systems.size(); i++) {
            SystemLayout system = page.systems.get(i);
            MeasurePlacement from = null, to = null;
            for (MeasurePlacement placement : system.measures) {
                if (placement.index < first || placement.index > last) continue;
                if (from == null) from = placement;
                to = placement;
            }
            if (from == null) continue;
            float y = page.y.get(i);
            float top = y + system.staffY[0] - 1.5f, bottom = y + system.staffY[staffCount - 1] + 5.5f;
            boxes.add(new float[]{i, from.x / pageWidth, to.end() / pageWidth,
                    Math.max(0, top / pageHeight), Math.min(1, bottom / pageHeight)});
        }
        return boxes;
    }

    /** First tick of a system, or -1 if the page has no such system. */
    int systemStartTick(int pageIndex, int systemIndex) {
        if (pageIndex < 0 || pageIndex >= pages.size()) return -1;
        PageLayout page = pages.get(pageIndex);
        return systemIndex < 0 || systemIndex >= page.systems.size() ? -1 : page.systems.get(systemIndex).startTick();
    }

    void drawPage(ScorePainter painter, int pageIndex) {
        PageLayout page = pages.get(pageIndex);
        if (page.title) {
            float y = marginTop, center = pageWidth / 2;
            if (!score.title.isEmpty()) { y += TITLE * 1.1f; painter.text(score.title, center, y - TITLE * 0.25f, TITLE, 0, ScorePainter.CENTER); }
            if (!score.subtitle.isEmpty()) { y += SUBTITLE * 1.4f; painter.text(score.subtitle, center, y - SUBTITLE * 0.3f, SUBTITLE, 0, ScorePainter.CENTER); }
            if (!score.composer.isEmpty() || !score.lyricist.isEmpty()) {
                y += COMPOSER * 1.8f;
                painter.text(score.composer, pageWidth - marginRight, y - COMPOSER * 0.3f, COMPOSER, 0, ScorePainter.RIGHT);
                painter.text(score.lyricist, marginLeft, y - COMPOSER * 0.3f, COMPOSER, 0, ScorePainter.LEFT);
            }
        }
        for (int i = 0; i < page.systems.size(); i++) drawSystem(new OffsetPainter(painter, 0, page.y.get(i)), page.systems.get(i));
    }

    // ---- drawing ----------------------------------------------------------------------------------------------

    private void drawSystem(ScorePainter p, SystemLayout system) {
        for (int s = 0; s < staffCount; s++) drawStaff(new OffsetPainter(p, 0, system.staffY[s]), system, s);
        float bottom = system.staffY[staffCount - 1] + 4;
        if (staffCount > 1) p.line(system.x0, 0, system.x0, bottom, THIN);
        for (int s = 0; s < staffCount; s++) {
            Staff staff = score.staves.get(s);
            if (staff.bracket == 0) continue;
            int end = Math.min(staffCount - 1, s + staff.bracketSpan - 1);
            if (end == s && staff.bracket == 2) continue;
            float top = system.staffY[s], bracketBottom = system.staffY[end] + 4;
            if (staff.bracket == 2) {
                float scale = (bracketBottom - top) / 4f;
                p.glyph(Glyphs.BRACE, system.x0 - 0.35f - Glyphs.width(Glyphs.BRACE) * scale, bracketBottom, scale);
            } else {
                float x = system.x0 - 0.8f;
                p.line(x, top - 0.45f, x, bracketBottom + 0.45f, 0.45f);
                p.curveBand(x - 0.225f, top - 0.45f, x + 0.5f, top - 0.45f, x + 1.0f, top - 0.6f,
                        x + 0.5f, top - 0.05f, x + 1.0f, top - 0.6f, x + 1.4f, top - 1.15f);
                p.curveBand(x - 0.225f, bracketBottom + 0.45f, x + 0.5f, bracketBottom + 0.45f, x + 1.0f, bracketBottom + 0.6f,
                        x + 0.5f, bracketBottom + 0.05f, x + 1.0f, bracketBottom + 0.6f, x + 1.4f, bracketBottom + 1.15f);
            }
        }
        // Barlines run through all staves of a barline group.
        int group = 0;
        while (group < staffCount) {
            int end = group;
            while (end + 1 < staffCount && score.staves.get(end).barLineToNext) end++;
            for (MeasurePlacement placement : system.measures) {
                Measure measure = placement.measure;
                String type = measure.endRepeat > 0 ? "end-repeat" : measure.endBarline;
                drawBarline(p, type, placement.end(), system, group, end);
                if (measure.startRepeat) drawBarline(p, "start-repeat", placement.x, system, group, end);
            }
            group = end + 1;
        }
        if (showNames) {
            for (int s = 0; s < staffCount; s++) {
                Staff staff = score.staves.get(s);
                String name = system.firstSystem ? staff.name : staff.shortName;
                if (name.isEmpty()) continue;
                int end = s;
                while (end + 1 < staffCount && score.staves.get(end + 1).part == staff.part) end++;
                float center = (system.staffY[s] + system.staffY[end] + 4) / 2;
                p.text(name, system.x0 - bracketWidth() - 0.6f, center + NAME * 0.35f, NAME, 0, ScorePainter.RIGHT);
            }
        }
    }

    private void drawBarline(ScorePainter p, String type, float x, SystemLayout system, int firstStaff, int lastStaff) {
        float top = system.staffY[firstStaff], bottom = system.staffY[lastStaff] + 4;
        if (type == null) { p.line(x - THIN / 2, top, x - THIN / 2, bottom, THIN); return; }
        switch (type) {
            case "double":
            case "reverse-end":
                p.line(x - THIN / 2, top, x - THIN / 2, bottom, THIN);
                p.line(x - THIN * 1.5f - BAR_GAP, top, x - THIN * 1.5f - BAR_GAP, bottom, THIN);
                break;
            case "end":
                p.line(x - THICK / 2, top, x - THICK / 2, bottom, THICK);
                p.line(x - THICK - BAR_GAP - THIN / 2, top, x - THICK - BAR_GAP - THIN / 2, bottom, THIN);
                break;
            case "heavy":
                p.line(x - THICK / 2, top, x - THICK / 2, bottom, THICK);
                break;
            case "dashed": case "dotted": {
                float dash = type.equals("dashed") ? 0.6f : 0.2f, gap = type.equals("dashed") ? 0.57f : 0.3f;
                for (float y = top; y < bottom; y += dash + gap) p.line(x - THIN / 2, y, x - THIN / 2, Math.min(bottom, y + dash), THIN);
                break;
            }
            case "end-repeat": {
                p.line(x - THICK / 2, top, x - THICK / 2, bottom, THICK);
                float thin = x - THICK - BAR_GAP - THIN / 2;
                p.line(thin, top, thin, bottom, THIN);
                float dotX = thin - THIN / 2 - BAR_GAP - Glyphs.width(Glyphs.REPEAT_DOT);
                for (int s = firstStaff; s <= lastStaff; s++) {
                    p.glyph(Glyphs.REPEAT_DOT, dotX, system.staffY[s] + 1.5f, 1f);
                    p.glyph(Glyphs.REPEAT_DOT, dotX, system.staffY[s] + 2.5f, 1f);
                }
                break;
            }
            case "start-repeat": {
                p.line(x + THICK / 2, top, x + THICK / 2, bottom, THICK);
                float thin = x + THICK + BAR_GAP + THIN / 2;
                p.line(thin, top, thin, bottom, THIN);
                float dotX = thin + THIN / 2 + BAR_GAP;
                for (int s = firstStaff; s <= lastStaff; s++) {
                    p.glyph(Glyphs.REPEAT_DOT, dotX, system.staffY[s] + 1.5f, 1f);
                    p.glyph(Glyphs.REPEAT_DOT, dotX, system.staffY[s] + 2.5f, 1f);
                }
                break;
            }
            default:
                p.line(x - THIN / 2, top, x - THIN / 2, bottom, THIN);
        }
    }

    private void drawStaff(ScorePainter p, SystemLayout system, int s) {
        for (int i = 0; i < 5; i++) p.line(system.x0, i, system.x1, i, STAFF_LINE);
        // Header: clef, key signature and, where it changes, the time signature.
        String clef = clefAtStart[system.first][s];
        float x = system.x0 + 0.75f;
        drawClef(p, clef, x, 1f);
        x += 2.6f + 0.8f;
        int maxKey = 0;
        for (int staff = 0; staff < staffCount; staff++) maxKey = Math.max(maxKey, (int) Math.ceil(keyWidth(keyAtStart[system.first][staff]) * 100));
        drawKey(p, clef, 0, keyAtStart[system.first][s], x);
        if (maxKey > 0) x += maxKey / 100f + 0.7f;
        Measure firstMeasure = score.measures.get(system.first);
        if (firstMeasure.timeChange || system.first == 0) drawTime(p, firstMeasure, x);

        for (MeasurePlacement placement : system.measures) {
            Measure measure = placement.measure;
            if (placement.systemStart) continue;
            float cx = placement.changesX;
            if (clefChanged[placement.index][s]) drawClef(p, clefAtStart[placement.index][s], cx, 0.75f);
            boolean anyClef = false;
            for (int staff = 0; staff < staffCount; staff++) anyClef |= clefChanged[placement.index][staff];
            if (anyClef) cx += 2.6f;
            float keyWidth = 0;
            for (int staff = 0; staff < staffCount; staff++)
                if (keyChanged[placement.index][staff]) keyWidth = Math.max(keyWidth, keyChangeWidth(keyBefore[placement.index][staff], keyAtStart[placement.index][staff]));
            if (keyChanged[placement.index][s])
                drawKey(p, clefAtStart[placement.index][s], keyBefore[placement.index][s], keyAtStart[placement.index][s], cx);
            if (keyWidth > 0) cx += keyWidth + 0.8f;
            if (measure.timeChange) drawTime(p, measure, cx);
        }
        // Mid-measure clef changes are drawn small in front of their segment.
        for (MeasurePlacement placement : system.measures) {
            for (ClefChange change : placement.measure.staves.get(s).clefs)
                if (change.tick > placement.measure.tick) drawClef(p, change.clef, placement.xAt(change.tick) - 2.3f, 0.75f);
        }
        if (s == 0 && !system.firstSystem) {
            Measure measure = score.measures.get(system.first);
            p.text(String.valueOf(measure.number), system.x0, -1.9f, NUMBER, ScorePainter.ITALIC, ScorePainter.LEFT);
        }

        List<ChordLayout> chords = system.chords.get(s);
        for (ChordLayout chord : chords) drawChord(p, chord);
        for (Beam beam : system.beams.get(s)) drawBeam(p, beam);
        drawTuplets(p, chords);
        drawTies(p, system, chords);
        for (Spanner spanner : score.spanners) {
            if (spanner.staff != s || !overlaps(system, spanner) && spanner.kind != Spanner.SLUR) continue;
            if (spanner.kind == Spanner.SLUR) drawSlur(p, system, spanner);
            else if (spanner.kind == Spanner.VOLTA) { if (s == 0) drawVolta(p, system, spanner); }
            else drawHairpin(p, system, s, spanner);
        }
        drawLyrics(p, system, chords);
        drawAnnotations(p, system, s);
    }

    private void drawClef(ScorePainter p, String clef, float x, float scale) {
        int origin = clefOrigin(clef);
        p.glyph(clefGlyph(clef), x, origin * 0.5f, scale);
    }

    private void drawKey(ScorePainter p, String clef, int before, int key, float x) {
        int shift = clefTopLine(clef) - 38;
        while (shift < -1) shift += 7;
        while (shift > 5) shift -= 7;
        int naturals = naturalsNeeded(before, key);
        if (naturals > 0) {
            boolean sharps = before > 0;
            int start = Integer.signum(before) == Integer.signum(key) ? Math.abs(key) : 0;
            for (int i = start; i < start + naturals && i < 7; i++) {
                int position = (sharps ? SHARP_POSITIONS[i] : FLAT_POSITIONS[i]) + shift;
                p.glyph(Glyphs.NATURAL, x, position * 0.5f, 1f);
                x += 0.8f;
            }
            if (key != 0) x += 0.4f;
        }
        for (int i = 0; i < Math.min(7, Math.abs(key)); i++) {
            int position = (key > 0 ? SHARP_POSITIONS[i] : FLAT_POSITIONS[i]) + shift;
            if (key > 0 && clef.equals("C4")) position = new int[]{6, 2, 5, 1, 4, 0, 3}[i];
            p.glyph(key > 0 ? Glyphs.SHARP : Glyphs.FLAT, x, position * 0.5f, 1f);
            x += key > 0 ? 1.0f : 0.95f;
        }
    }

    private void drawTime(ScorePainter p, Measure measure, float x) {
        if (measure.timeSymbol == 1 || measure.timeSymbol == 2) {
            p.glyph(measure.timeSymbol == 1 ? Glyphs.TIME_COMMON : Glyphs.TIME_CUT, x, 2f, 1f);
            return;
        }
        String numerator = String.valueOf(measure.timeN), denominator = String.valueOf(measure.timeD);
        float width = timeWidth(measure);
        drawDigits(p, numerator, x + (width - digitsWidth(numerator)) / 2, 1f);
        drawDigits(p, denominator, x + (width - digitsWidth(denominator)) / 2, 3f);
    }

    private void drawDigits(ScorePainter p, String digits, float x, float y) {
        for (char c : digits.toCharArray()) {
            if (c < '0' || c > '9') continue;
            char glyph = Glyphs.TIME_DIGITS[c - '0'];
            p.glyph(glyph, x - 0.06f, y, 1f);
            x += Glyphs.width(glyph) - 0.06f;
        }
    }

    private void drawChord(ScorePainter p, ChordLayout chord) {
        ChordRest cr = chord.cr;
        if (!cr.visible) return;
        if (cr.rest) {
            p.glyph(chord.restGlyph, chord.x, chord.restY, chord.scale);
            for (int i = 0; i < cr.dots; i++) p.glyph(Glyphs.DOT, chord.dotX + i * 0.5f, chord.restY > 2.5f ? 2.5f : 1.5f, 1f);
            return;
        }
        drawGraces(p, chord);
        float scale = chord.scale;
        float ledgerLeft = Float.MAX_VALUE, ledgerRight = -Float.MAX_VALUE;
        for (float x : chord.noteX) { ledgerLeft = Math.min(ledgerLeft, x); ledgerRight = Math.max(ledgerRight, x + chord.noteWidth); }
        drawLedgers(p, chord.topNoteY(), chord.bottomNoteY(), ledgerLeft - 0.33f * scale, ledgerRight + 0.33f * scale);
        for (int i = 0; i < chord.notes.size(); i++) {
            Note note = chord.notes.get(i);
            float y = note.position * 0.5f;
            p.glyph(chord.head, chord.noteX[i], y, scale);
            if (note.shownAccidental != 0) p.glyph(note.shownAccidental, chord.accX[i], y, scale);
            for (int d = 0; d < cr.dots; d++) {
                float dotY = note.position % 2 == 0 ? y + (chord.multiVoice && cr.voice % 2 == 1 ? 0.5f : -0.5f) : y;
                p.glyph(Glyphs.DOT, chord.dotX + d * 0.5f, dotY, scale);
            }
        }
        if (chord.hasStem) p.line(chord.stemX, chord.stemStartY, chord.stemX, chord.stemEndY, STEM * scale);
        if (chord.flags > 0 && chord.beam == null) {
            char flag = chord.up ? Glyphs.FLAGS_UP[chord.flags - 1] : Glyphs.FLAGS_DOWN[chord.flags - 1];
            p.glyph(flag, chord.stemX - STEM * scale / 2, chord.stemEndY, scale);
        }
        for (float[] mark : chord.marks) p.glyph((char) mark[0], mark[1], mark[2], mark[3]);
    }

    private void drawLedgers(ScorePainter p, float topY, float bottomY, float left, float right) {
        for (float y = -1; y >= topY - 0.01f; y -= 1) p.line(left, y, right, y, LEDGER);
        for (float y = 5; y <= bottomY + 0.01f; y += 1) p.line(left, y, right, y, LEDGER);
    }

    private void drawGraces(ScorePainter p, ChordLayout chord) {
        int n = chord.cr.graces.size();
        if (n == 0) return;
        float left = chord.x;
        for (float x : chord.noteX) left = Math.min(left, x);
        for (float x : chord.accX) if (x != 0) left = Math.min(left, x);
        float width = Glyphs.width(Glyphs.NOTEHEAD_BLACK) * GRACE;
        for (int k = 0; k < n; k++) {
            ChordRest grace = chord.cr.graces.get(k);
            if (grace.notes.isEmpty()) continue;
            float x = left - 0.3f - (n - k) * 1.25f;
            float top = grace.notes.get(0).position * 0.5f, bottom = grace.notes.get(grace.notes.size() - 1).position * 0.5f;
            drawLedgers(p, top, bottom, x - 0.25f, x + width + 0.25f);
            for (Note note : grace.notes) {
                p.glyph(Glyphs.NOTEHEAD_BLACK, x, note.position * 0.5f, GRACE);
                if (note.shownAccidental != 0) p.glyph(note.shownAccidental, x - 0.2f - Glyphs.width(note.shownAccidental) * GRACE, note.position * 0.5f, GRACE);
            }
            float stemX = x + width - STEM * GRACE / 2, end = top - 2.4f;
            p.line(stemX, bottom - 0.1f, stemX, end, STEM * GRACE);
            if (grace.value >= 8) p.glyph(Glyphs.FLAGS_UP[Math.min(3, Integer.numberOfTrailingZeros(grace.value) - 3)], stemX - STEM * GRACE / 2, end, GRACE);
        }
    }

    private void drawBeam(ScorePainter p, Beam beam) {
        float direction = beam.up ? 1 : -1;
        int levels = 0;
        for (ChordLayout chord : beam.chords) levels = Math.max(levels, chord.flags);
        for (int level = 0; level < levels; level++) {
            float offset = level * BEAM_DISTANCE * direction;
            int i = 0;
            while (i < beam.chords.size()) {
                if (beam.chords.get(i).flags <= level) { i++; continue; }
                int j = i;
                while (j + 1 < beam.chords.size() && beam.chords.get(j + 1).flags > level) j++;
                float xa = beam.chords.get(i).stemX - STEM / 2, xb = beam.chords.get(j).stemX + STEM / 2;
                if (i == j) {
                    // A lonely shorter note gets a beam stub pointing into the group.
                    boolean left = i == beam.chords.size() - 1 || i > 0 && beam.chords.get(i - 1).cr.dots > 0;
                    if (left) { xb = xa + STEM; xa = xb - 1.1f; } else xb = xa + 1.1f;
                }
                float ya = beam.yAt(xa) + offset, yb = beam.yAt(xb) + offset;
                p.polygon(new float[]{xa, ya, xb, yb, xb, yb + BEAM * direction, xa, ya + BEAM * direction});
                i = j + 1;
            }
        }
    }

    private void drawTuplets(ScorePainter p, List<ChordLayout> chords) {
        for (ChordLayout chord : chords) {
            Tuplet tuplet = chord.cr.tuplet;
            if (tuplet == null || tuplet.members.get(0) != chord.cr || !tuplet.showNumber) continue;
            List<ChordLayout> members = new ArrayList<>();
            for (ChordRest member : tuplet.members) {
                ChordLayout layout = chordLayouts.get(member);
                if (layout == null || layout.system != chord.system) { members = null; break; }
                members.add(layout);
            }
            if (members == null || members.isEmpty()) continue;
            int upCount = 0;
            Beam beam = members.get(0).beam;
            boolean oneBeam = beam != null;
            for (ChordLayout member : members) {
                if (member.cr.rest || member.up) upCount++;
                if (member.beam != beam) oneBeam = false;
            }
            boolean above = upCount * 2 >= members.size();
            ChordLayout first = members.get(0), last = members.get(members.size() - 1);
            float left = first.x - 0.3f, right = last.x + last.noteWidth + 0.3f;
            float edge = above ? Float.MAX_VALUE : -Float.MAX_VALUE;
            for (ChordLayout member : members) edge = above ? Math.min(edge, member.top) : Math.max(edge, member.bottom);
            edge = above ? Math.min(edge, -0.3f) - 0.9f : Math.max(edge, 4.3f) + 0.9f;
            String number = String.valueOf(tuplet.actual);
            float center = (left + right) / 2;
            if (oneBeam) {
                boolean beamSide = beam.up == above;
                float y = beamSide ? (above ? beam.yAt(center) - 0.8f : beam.yAt(center) + 1.8f)
                        : (above ? edge + 0.6f : edge + 1.0f);
                p.text(number, center, y, TUPLET, ScorePainter.BOLD | ScorePainter.ITALIC, ScorePainter.CENTER);
            } else {
                float half = p.textWidth(number, TUPLET, ScorePainter.BOLD | ScorePainter.ITALIC) / 2 + 0.4f;
                float hook = above ? 0.6f : -0.6f;
                p.line(left, edge + hook, left, edge, 0.1f);
                p.line(left, edge, center - half, edge, 0.1f);
                p.line(center + half, edge, right, edge, 0.1f);
                p.line(right, edge, right, edge + hook, 0.1f);
                p.text(number, center, edge + TUPLET * 0.35f, TUPLET, ScorePainter.BOLD | ScorePainter.ITALIC, ScorePainter.CENTER);
            }
        }
    }

    private void drawTies(ScorePainter p, SystemLayout system, List<ChordLayout> chords) {
        for (ChordLayout chord : chords) {
            if (chord.cr.rest) continue;
            for (int i = 0; i < chord.notes.size(); i++) {
                Note note = chord.notes.get(i);
                boolean up = tieUp(chord, i);
                float offset = up ? -0.45f : 0.45f;
                float y = note.position * 0.5f + offset;
                if (note.tieTo != null) {
                    ChordLayout target = noteOwners.get(note.tieTo);
                    float start = chord.noteX[i] + chord.noteWidth + 0.15f + (chord.cr.dots > 0 ? 0.25f + chord.cr.dots * 0.5f : 0);
                    float end;
                    if (target != null && target.system == system) {
                        int index = target.notes.indexOf(note.tieTo);
                        end = (index >= 0 ? target.noteX[index] : target.x) - 0.15f;
                    } else end = system.x1 - 0.3f;
                    drawArc(p, start, y, end, y, up, 0.18f);
                }
                Note source = tieSources.get(note);
                if (source != null) {
                    ChordLayout origin = noteOwners.get(source);
                    if (origin == null || origin.system != system) drawArc(p, system.headerEnd - 0.8f, y, chord.noteX[i] - 0.15f, y, up, 0.18f);
                }
            }
        }
    }

    private boolean tieUp(ChordLayout chord, int noteIndex) {
        if (chord.multiVoice) return chord.cr.voice % 2 == 0;
        int n = chord.notes.size();
        if (n == 1) return !chord.up;
        if (n % 2 == 1 && noteIndex == n / 2) return chord.notes.get(noteIndex).position < 4;
        return noteIndex < n / 2.0f;
    }

    private void drawArc(ScorePainter p, float x1, float y1, float x2, float y2, boolean up, float thickness) {
        float length = x2 - x1;
        if (length < 0.3f) return;
        float height = Math.min(1.1f, 0.25f + length * 0.06f);
        drawCurve(p, x1, y1, x2, y2, up, height / 0.75f, thickness);
    }

    private void drawCurve(ScorePainter p, float x1, float y1, float x2, float y2, boolean up, float bulge, float thickness) {
        float direction = up ? -1 : 1;
        float dx = (x2 - x1) / 4, dy = (y2 - y1) / 4;
        float inner = Math.max(0.1f, bulge - thickness / 0.75f);
        p.curveBand(x1, y1,
                x1 + dx, y1 + dy + direction * bulge, x2 - dx, y2 - dy + direction * bulge,
                x1 + dx, y1 + dy + direction * inner, x2 - dx, y2 - dy + direction * inner,
                x2, y2);
    }

    private void drawSlur(ScorePainter p, SystemLayout system, Spanner slur) {
        ChordLayout start = chordLayouts.get(slur.start), end = chordLayouts.get(slur.end);
        boolean startHere = start != null && start.system == system, endHere = end != null && end.system == system;
        if (!startHere && !endHere) {
            if (slur.startTick < system.startTick() && slur.endTick >= system.endTick() && start != null && end != null) {
                boolean above = !(start.up && end.up);
                float y = above ? Math.min(-1f, system.chordsTop[slur.staff] - 0.5f) : Math.max(5f, system.chordsBottom[slur.staff] + 0.5f);
                drawCurve(p, system.headerEnd, y, system.x1, y, above, 1.2f, 0.18f);
            }
            return;
        }
        ChordLayout reference = startHere ? start : end;
        boolean above;
        if (reference.multiVoice) above = reference.cr.voice % 2 == 0;
        else above = !((start == null || start.up) && (end == null || end.up));
        float x1, y1, x2, y2;
        if (startHere) { x1 = slurX(start, above); y1 = slurY(start, above); }
        else { x1 = system.headerEnd; y1 = slurY(end, above); }
        if (endHere) { x2 = slurX(end, above); y2 = slurY(end, above); }
        else { x2 = system.x1 - 0.3f; y2 = y1; }
        if (x2 - x1 < 0.5f) return;
        float bulge = Math.max(1.0f, Math.min(2.6f, (x2 - x1) * 0.12f)) / 0.75f;
        for (ChordLayout chord : system.chords.get(slur.staff)) {
            if (chord == start || chord == end || chord.cr.voice != reference.cr.voice || chord.cr.rest) continue;
            float x = chord.centerX();
            if (x <= x1 || x >= x2) continue;
            float t = (x - x1) / (x2 - x1);
            float line = y1 + (y2 - y1) * t;
            float need = above ? line - (chord.top - 0.5f) : (chord.bottom + 0.5f) - line;
            if (need > 0) bulge = Math.max(bulge, need / (3 * t * (1 - t)));
        }
        drawCurve(p, x1, y1, x2, y2, above, Math.min(bulge, 6f), 0.2f);
    }

    private static float slurX(ChordLayout chord, boolean above) {
        if (chord.hasStem && chord.up == above) return chord.stemX;
        return chord.centerX();
    }

    private static float slurY(ChordLayout chord, boolean above) {
        if (chord.cr.rest) return above ? chord.top - 0.5f : chord.bottom + 0.5f;
        if (chord.hasStem && chord.up == above) return chord.stemEndY + (above ? -0.4f : 0.4f);
        return above ? chord.topNoteY() - 0.9f : chord.bottomNoteY() + 0.9f;
    }

    private void drawHairpin(ScorePainter p, SystemLayout system, int s, Spanner hairpin) {
        boolean startHere = hairpin.startTick >= system.startTick(), endHere = hairpin.endTick <= system.endTick();
        float x1 = startHere ? system.xAt(hairpin.startTick, false) : system.headerEnd;
        float x2 = endHere ? system.xAt(hairpin.endTick, true) - 0.6f : system.x1 - 0.3f;
        if (startHere) {
            Annotation dynamic = annotationAt(system, s, hairpin.startTick, Annotation.DYNAMIC);
            if (dynamic != null) x1 += dynamicWidth(p, dynamic.text) / 2 + 0.6f;
        }
        if (endHere) {
            Annotation dynamic = annotationAt(system, s, hairpin.endTick, Annotation.DYNAMIC);
            if (dynamic != null) x2 = Math.min(x2, noteCenterAt(system, s, hairpin.endTick) - dynamicWidth(p, dynamic.text) / 2 - 0.6f);
        }
        if (x2 - x1 < 1f) return;
        float y = system.dynamicBase[s] - 0.6f, open = 0.6f;
        boolean crescendo = hairpin.kind == Spanner.CRESCENDO;
        float startOpen = crescendo ? (startHere ? 0 : open * 0.5f) : open;
        float endOpen = crescendo ? open : (endHere ? 0 : open * 0.5f);
        p.line(x1, y - startOpen, x2, y - endOpen, 0.12f);
        p.line(x1, y + startOpen, x2, y + endOpen, 0.12f);
    }

    private void drawVolta(ScorePainter p, SystemLayout system, Spanner volta) {
        boolean startHere = volta.startTick >= system.startTick(), endHere = volta.endTick <= system.endTick();
        float x1 = startHere ? system.xAt(volta.startTick, true) + 0.4f : system.headerEnd;
        MeasurePlacement startPlacement = system.placement(volta.startTick);
        if (startHere && startPlacement != null && startPlacement.systemStart) x1 = system.headerEnd + 0.2f;
        float x2 = endHere ? system.xAt(volta.endTick, true) - 0.5f : system.x1;
        float y = system.voltaY[0];
        p.line(x1, y, x2, y, 0.11f);
        if (startHere) {
            p.line(x1, y, x1, y + 2.2f, 0.11f);
            p.text(volta.text, x1 + 0.5f, y + 1.9f, 11 * PT, 0, ScorePainter.LEFT);
        }
        if (endHere && volta.endHook) p.line(x2, y, x2, y + 2.2f, 0.11f);
    }

    private void drawLyrics(ScorePainter p, SystemLayout system, List<ChordLayout> chords) {
        List<ChordLayout> ordered = new ArrayList<>(chords);
        Collections.sort(ordered, (a, b) -> Integer.compare(a.cr.tick, b.cr.tick));
        Map<Integer, float[]> pendingHyphen = new java.util.HashMap<>();
        for (ChordLayout chord : ordered) {
            for (Lyric lyric : chord.cr.lyrics) {
                float baseline = system.lyricBase[chord.staff] + lyric.verse * 2.5f;
                float center = chord.cr.rest ? chord.x + chord.noteWidth / 2 : chord.centerX();
                float width = p.textWidth(lyric.text, LYRICS, 0);
                float[] hyphen = pendingHyphen.remove(lyric.verse);
                if (hyphen != null) {
                    float from = hyphen[0], to = center - width / 2;
                    if (to - from > 0.8f) p.line((from + to) / 2 - 0.4f, baseline - LYRICS * 0.28f, (from + to) / 2 + 0.4f, baseline - LYRICS * 0.28f, 0.12f);
                }
                p.text(lyric.text, center, baseline, LYRICS, 0, ScorePainter.CENTER);
                if ("begin".equals(lyric.syllabic) || "middle".equals(lyric.syllabic)) pendingHyphen.put(lyric.verse, new float[]{center + width / 2});
            }
        }
    }

    private Annotation annotationAt(SystemLayout system, int s, int tick, int kind) {
        for (MeasurePlacement placement : system.measures)
            for (Annotation annotation : placement.measure.staves.get(s).annotations)
                if (annotation.kind == kind && annotation.tick == tick) return annotation;
        return null;
    }

    private float noteCenterAt(SystemLayout system, int s, int tick) {
        for (ChordLayout chord : system.chords.get(s)) if (chord.cr.tick == tick && chord.cr.voice == 0) return chord.cr.rest ? chord.x + chord.noteWidth / 2 : chord.centerX();
        for (ChordLayout chord : system.chords.get(s)) if (chord.cr.tick == tick) return chord.centerX();
        return system.xAt(tick, false) + 0.65f;
    }

    private static boolean isDynamicLetters(String text) {
        if (text.isEmpty()) return false;
        for (char c : text.toCharArray()) if (Glyphs.dynamicLetter(c) == 0) return false;
        return true;
    }

    private float dynamicWidth(ScorePainter p, String text) {
        if (!isDynamicLetters(text)) return p.textWidth(text, TEXT, ScorePainter.ITALIC);
        float width = 0;
        for (char c : text.toCharArray()) width += Glyphs.box(Glyphs.dynamicLetter(c))[2] + 0.05f;
        return width;
    }

    private void drawDynamic(ScorePainter p, String text, float center, float baseline) {
        if (!isDynamicLetters(text)) { p.text(text, center, baseline, TEXT, ScorePainter.ITALIC, ScorePainter.CENTER); return; }
        float x = center - dynamicWidth(p, text) / 2;
        for (char c : text.toCharArray()) {
            char glyph = Glyphs.dynamicLetter(c);
            p.glyph(glyph, x, baseline, 1f);
            x += Glyphs.box(glyph)[2] + 0.05f;
        }
    }

    private void drawAnnotations(ScorePainter p, SystemLayout system, int s) {
        List<List<float[]>> rows = new ArrayList<>();
        List<Float> rowHeights = new ArrayList<>();
        for (MeasurePlacement placement : system.measures) {
            Measure measure = placement.measure;
            int measureEnd = measure.tick + measure.ticks;
            for (Annotation annotation : measure.staves.get(s).annotations) {
                switch (annotation.kind) {
                    case Annotation.DYNAMIC:
                        drawDynamic(p, annotation.text, noteCenterAt(system, s, annotation.tick), system.dynamicBase[s]);
                        continue;
                    case Annotation.TEXT_BELOW:
                        p.text(annotation.text, system.xAt(annotation.tick, false), system.dynamicBase[s], TEXT, ScorePainter.ITALIC, ScorePainter.LEFT);
                        continue;
                    default:
                }
                float size, height; int style = 0; boolean boxed = false; char glyph = 0;
                switch (annotation.kind) {
                    case Annotation.TEMPO: size = TEMPO; style = ScorePainter.BOLD; break;
                    case Annotation.REHEARSAL: size = REHEARSAL; style = ScorePainter.BOLD; boxed = true; break;
                    case Annotation.CHORD_SYMBOL: size = CHORD_SYMBOL; break;
                    case Annotation.SEGNO: size = 0; glyph = Glyphs.SEGNO; break;
                    case Annotation.CODA: size = 0; glyph = Glyphs.CODA; break;
                    default: size = TEXT;
                }
                boolean atEnd = annotation.tick >= measureEnd;
                String[] lines = annotation.text.split("\n");
                float width = 0;
                if (glyph != 0) width = Glyphs.width(glyph);
                else for (String line : lines) width = Math.max(width, p.textWidth(line, size, style));
                height = glyph != 0 ? 3.6f : size * 0.8f + (lines.length - 1) * size * 1.15f + (boxed ? 0.8f : 0);
                float x;
                if (atEnd) x = placement.end() - width - 0.2f;
                else if (glyph != 0 || annotation.kind == Annotation.REHEARSAL) x = placement.xAt(annotation.tick) - (annotation.tick == measure.tick ? 1.0f : 0);
                else x = placement.xAt(annotation.tick);
                x = Math.max(marginLeft, Math.min(x, system.x1 - width));
                // Stack texts in rows above the staff so that they never overlap.
                int row = 0;
                while (true) {
                    if (row >= rows.size()) { rows.add(new ArrayList<>()); rowHeights.add(0f); }
                    boolean free = true;
                    for (float[] used : rows.get(row)) if (x < used[1] + 0.8f && x + width + 0.8f > used[0]) free = false;
                    if (free) break;
                    row++;
                }
                float baseline = system.textBase[s];
                for (int r = 0; r < row; r++) baseline -= rowHeights.get(r) + 0.6f;
                rows.get(row).add(new float[]{x, x + width});
                rowHeights.set(row, Math.max(rowHeights.get(row), height));
                if (glyph != 0) { p.glyph(glyph, x, baseline, 1f); continue; }
                for (int i = 0; i < lines.length; i++)
                    p.text(lines[i], x, baseline - (lines.length - 1 - i) * size * 1.15f, size, style, ScorePainter.LEFT);
                if (boxed) p.frame(x - 0.5f, baseline - size * 0.8f - 0.4f, x + width + 0.5f, baseline + 0.5f, 0.15f);
            }
        }
    }

    // ---- painters ---------------------------------------------------------------------------------------------

    /** Translates all drawing by a fixed offset. */
    private static final class OffsetPainter implements ScorePainter {
        private final ScorePainter target; private final float dx, dy;
        OffsetPainter(ScorePainter target, float dx, float dy) { this.target = target; this.dx = dx; this.dy = dy; }
        @Override public void line(float x1, float y1, float x2, float y2, float width) { target.line(x1 + dx, y1 + dy, x2 + dx, y2 + dy, width); }
        @Override public void polygon(float[] points) {
            float[] moved = points.clone();
            for (int i = 0; i + 1 < moved.length; i += 2) { moved[i] += dx; moved[i + 1] += dy; }
            target.polygon(moved);
        }
        @Override public void curveBand(float x1, float y1, float ax, float ay, float bx, float by, float cx, float cy, float ex, float ey, float x2, float y2) {
            target.curveBand(x1 + dx, y1 + dy, ax + dx, ay + dy, bx + dx, by + dy, cx + dx, cy + dy, ex + dx, ey + dy, x2 + dx, y2 + dy);
        }
        @Override public void glyph(char glyph, float x, float y, float scale) { target.glyph(glyph, x + dx, y + dy, scale); }
        @Override public void text(String text, float x, float y, float size, int style, int align) { target.text(text, x + dx, y + dy, size, style, align); }
        @Override public float textWidth(String text, float size, int style) { return target.textWidth(text, size, style); }
        @Override public void frame(float left, float top, float right, float bottom, float width) { target.frame(left + dx, top + dy, right + dx, bottom + dy, width); }
    }

    /** Collects the vertical extent of everything drawn. */
    private static final class BoundsPainter implements ScorePainter {
        private final ScorePainter measurer;
        float minY = Float.MAX_VALUE, maxY = -Float.MAX_VALUE;
        BoundsPainter(ScorePainter measurer) { this.measurer = measurer; }
        private void add(float y) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        @Override public void line(float x1, float y1, float x2, float y2, float width) { add(Math.min(y1, y2) - width / 2); add(Math.max(y1, y2) + width / 2); }
        @Override public void polygon(float[] points) { for (int i = 1; i < points.length; i += 2) add(points[i]); }
        @Override public void curveBand(float x1, float y1, float ax, float ay, float bx, float by, float cx, float cy, float dx, float dy, float x2, float y2) {
            add(y1); add(y2);
            add(0.125f * y1 + 0.375f * ay + 0.375f * by + 0.125f * y2);
            add(0.125f * y1 + 0.375f * cy + 0.375f * dy + 0.125f * y2);
        }
        @Override public void glyph(char glyph, float x, float y, float scale) {
            float[] box = Glyphs.box(glyph);
            if (box == null) { add(y - scale); add(y + scale); return; }
            add(y + box[1] * scale); add(y + box[3] * scale);
        }
        @Override public void text(String text, float x, float y, float size, int style, int align) {
            if (text == null || text.isEmpty()) return;
            add(y - size * 0.75f); add(y + size * 0.25f);
        }
        @Override public float textWidth(String text, float size, int style) { return measurer.textWidth(text, size, style); }
        @Override public void frame(float left, float top, float right, float bottom, float width) { add(top - width / 2); add(bottom + width / 2); }
    }
}
