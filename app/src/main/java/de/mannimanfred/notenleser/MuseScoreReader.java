package de.mannimanfred.notenleser;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;

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
 * Reads MuseScore files (.mscz archives and plain .mscx, format versions 2 to 4) into a {@link Score}.
 * Pitches, spellings, keys and clefs are converted to written pitch unless the score is saved in concert pitch.
 */
final class MuseScoreReader {
    /** Score-wide state while reading one staff. */
    private static final class StaffContext {
        int transposeChromatic, transposeDiatonic, fifths;
        String defaultClef = "G";
        boolean transposed() { return fifths != 0 || transposeChromatic % 12 != 0; }
    }

    /** A spanner whose end is given relative to its start and resolved once all measures are known. */
    private static final class PendingSpanner {
        Spanner spanner; int startMeasure; int measures; int fractionTicks; boolean resolved;
    }

    private final Score score = new Score();
    private final List<StaffContext> contexts = new ArrayList<>();
    private final List<PendingSpanner> pending = new ArrayList<>();
    private final Map<String, Spanner> legacySpanners = new HashMap<>();
    private final Map<String, Tuplet> legacyTuplets = new HashMap<>();
    private boolean concertPitch;
    private float version = 4f;
    private int timeN = 4, timeD = 4;

    static Score read(byte[] data) throws IOException {
        try { return new MuseScoreReader().parse(data); }
        catch (IOException e) { throw e; }
        catch (Exception e) { throw new IOException("MuseScore-Datei kann nicht gelesen werden: " + e.getMessage(), e); }
    }

    static boolean looksLikeMuseScore(byte[] head, String name) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".mscz") || lower.endsWith(".mscx")) return true;
        String start = new String(head, 0, Math.min(head.length, 400), StandardCharsets.UTF_8);
        return start.contains("<museScore");
    }

    private Score parse(byte[] data) throws Exception {
        byte[] scoreXml = data, styleXml = null;
        if (data.length > 4 && data[0] == 'P' && data[1] == 'K') {
            Map<String, byte[]> entries = unzip(data);
            String root = null;
            byte[] container = entries.get("META-INF/container.xml");
            if (container != null) {
                for (Element file : descendants(parseXml(container).getDocumentElement(), "rootfile")) {
                    String path = file.getAttribute("full-path");
                    if (path.toLowerCase(Locale.ROOT).endsWith(".mscx")) { root = path; break; }
                }
            }
            if (root == null) for (String name : entries.keySet()) if (name.toLowerCase(Locale.ROOT).endsWith(".mscx")) { root = name; break; }
            if (root == null || !entries.containsKey(root)) throw new IOException("Im MuseScore-Archiv fehlt die Partitur");
            scoreXml = entries.get(root);
            for (Map.Entry<String, byte[]> entry : entries.entrySet())
                if (entry.getKey().toLowerCase(Locale.ROOT).endsWith(".mss")) styleXml = entry.getValue();
        }
        Element museScore = parseXml(scoreXml).getDocumentElement();
        try { version = Float.parseFloat(museScore.getAttribute("version")); } catch (NumberFormatException ignored) { }
        Element scoreElement = child(museScore, "Score");
        if (scoreElement == null) throw new IOException("Keine Partitur in der Datei gefunden");
        if (styleXml != null) {
            Element style = child(parseXml(styleXml).getDocumentElement(), "Style");
            if (style != null) applyStyle(style);
        }
        Element style = child(scoreElement, "Style");
        if (style != null) applyStyle(style);
        score.division = intValue(child(scoreElement, "Division"), 480);

        for (Element metaTag : children(scoreElement, "metaTag")) {
            String name = metaTag.getAttribute("name"), value = metaTag.getTextContent().trim();
            if (value.isEmpty()) continue;
            if (name.equals("workTitle") && score.title.isEmpty()) score.title = value;
            else if (name.equals("composer") && score.composer.isEmpty()) score.composer = value;
            else if (name.equals("lyricist") && score.lyricist.isEmpty()) score.lyricist = value;
            else if (name.equals("subtitle") && score.subtitle.isEmpty()) score.subtitle = value;
        }

        int partIndex = 0;
        for (Element part : children(scoreElement, "Part")) {
            Element instrument = child(part, "Instrument");
            String longName = text(instrument, "longName"), shortName = text(instrument, "shortName");
            if (longName.isEmpty()) longName = text(part, "trackName");
            int staffInPart = 0;
            for (Element staffElement : children(part, "Staff")) {
                staffInPart++;
                Staff staff = new Staff(); StaffContext context = new StaffContext();
                staff.part = partIndex; staff.name = staffInPart == 1 ? longName : ""; staff.shortName = staffInPart == 1 ? shortName : "";
                if (instrument != null) {
                    Element channel = child(instrument, "Channel");
                    Element program = channel == null ? null : child(channel, "program");
                    if (program != null) staff.program = Math.max(0, Math.min(127, parseInt(program.getAttribute("value"), 0)));
                    context.transposeChromatic = intValue(child(instrument, "transposeChromatic"), 0);
                    context.transposeDiatonic = intValue(child(instrument, "transposeDiatonic"), 0);
                    for (Element clef : children(instrument, "clef")) {
                        String target = clef.getAttribute("staff");
                        if (target.isEmpty() ? staffInPart == 1 : target.equals(String.valueOf(staffInPart)))
                            context.defaultClef = clefName(clef.getTextContent().trim());
                    }
                }
                Element staffType = child(staffElement, "StaffType");
                if (staffType != null && "percussion".equals(staffType.getAttribute("group"))) context.defaultClef = "PERC";
                String defaultClef = text(staffElement, "defaultClef");
                if (!defaultClef.isEmpty()) context.defaultClef = clefName(defaultClef);
                Element bracket = child(staffElement, "bracket");
                if (bracket != null) {
                    int type = parseInt(bracket.getAttribute("type"), -1), span = parseInt(bracket.getAttribute("span"), 0);
                    if (type >= 0 && span > 0) { staff.bracket = type == 1 ? 2 : 1; staff.bracketSpan = span; }
                }
                // MuseScore 2 counts the spanned staves including itself, later versions store a flag.
                staff.barLineToNext = intValue(child(staffElement, "barLineSpan"), 0) > (version < 3 ? 1 : 0);
                context.fifths = concertPitch ? 0 : transposeFifths(context.transposeChromatic, context.transposeDiatonic);
                staff.clef = context.defaultClef;
                score.staves.add(staff); contexts.add(context);
            }
            partIndex++;
        }
        List<Element> staffContents = new ArrayList<>();
        for (Element staffElement : children(scoreElement, "Staff")) staffContents.add(staffElement);
        // Files without part definitions still contain playable staves.
        while (score.staves.size() < staffContents.size()) {
            Staff staff = new Staff(); staff.part = score.staves.size();
            score.staves.add(staff); contexts.add(new StaffContext());
        }
        for (int staffIndex = 0; staffIndex < staffContents.size(); staffIndex++) {
            Element staffElement = staffContents.get(staffIndex);
            int id = parseInt(staffElement.getAttribute("id"), staffIndex + 1) - 1;
            readStaff(staffElement, id >= 0 && id < score.staves.size() ? id : staffIndex);
        }
        finish();
        return score;
    }

    private void applyStyle(Element style) {
        final float inch = 25.4f;
        float width = floatValue(child(style, "pageWidth"), -1), height = floatValue(child(style, "pageHeight"), -1);
        if (width > 0) score.pageWidthMm = width * inch;
        if (height > 0) score.pageHeightMm = height * inch;
        float left = floatValue(child(style, "pageOddLeftMargin"), -1);
        if (left >= 0) score.marginLeftMm = left * inch;
        float printable = floatValue(child(style, "pagePrintableWidth"), -1);
        if (printable > 0) score.marginRightMm = Math.max(0, score.pageWidthMm - score.marginLeftMm - printable * inch);
        float top = floatValue(child(style, "pageOddTopMargin"), -1);
        if (top >= 0) score.marginTopMm = top * inch;
        float bottom = floatValue(child(style, "pageOddBottomMargin"), -1);
        if (bottom >= 0) score.marginBottomMm = bottom * inch;
        float spatium = floatValue(child(style, "spatium"), floatValue(child(style, "Spatium"), -1));
        if (spatium > 0.3f) score.spatiumMm = spatium;
        if (child(style, "concertPitch") != null) concertPitch = intValue(child(style, "concertPitch"), 0) != 0;
        Element pageLayout = child(style, "page-layout");
        if (pageLayout != null) {
            // MuseScore 2 stores the page in 1/144 inch.
            final float unit = inch / 144f;
            width = floatValue(child(pageLayout, "page-width"), -1); height = floatValue(child(pageLayout, "page-height"), -1);
            if (width > 0) score.pageWidthMm = width * unit;
            if (height > 0) score.pageHeightMm = height * unit;
            Element margins = child(pageLayout, "page-margins");
            if (margins != null) {
                score.marginLeftMm = floatValue(child(margins, "left-margin"), score.marginLeftMm / unit) * unit;
                score.marginRightMm = floatValue(child(margins, "right-margin"), score.marginRightMm / unit) * unit;
                score.marginTopMm = floatValue(child(margins, "top-margin"), score.marginTopMm / unit) * unit;
                score.marginBottomMm = floatValue(child(margins, "bottom-margin"), score.marginBottomMm / unit) * unit;
            }
        }
    }

    private void readStaff(Element staffElement, int staffIndex) {
        int measureIndex = 0;
        timeN = 4; timeD = 4;
        for (Element element : children(staffElement)) {
            String tag = element.getTagName();
            if (tag.equals("VBox") || tag.equals("TBox")) {
                if (staffIndex == 0 && measureIndex == 0) readTitleFrame(element);
                else if (measureIndex > 0) applyLayoutBreaks(element, score.measures.get(measureIndex - 1));
            } else if (tag.equals("Measure")) {
                readMeasure(element, staffIndex, measureIndex++);
            }
        }
    }

    private void readTitleFrame(Element frame) {
        for (Element textElement : children(frame, "Text")) {
            String style = text(textElement, "style").toLowerCase(Locale.ROOT);
            Element textChild = child(textElement, "text");
            String value = textChild == null ? textElement.getTextContent().trim() : richText(textChild);
            if (value.isEmpty()) continue;
            if (style.equals("title")) score.title = value;
            else if (style.equals("subtitle")) score.subtitle = value;
            else if (style.equals("composer")) score.composer = value;
            else if (style.equals("lyricist") || style.equals("poet")) score.lyricist = value;
        }
    }

    private void readMeasure(Element element, int staffIndex, int measureIndex) {
        Measure measure;
        if (measureIndex < score.measures.size()) measure = score.measures.get(measureIndex);
        else {
            measure = new Measure();
            if (measureIndex > 0) {
                Measure previous = score.measures.get(measureIndex - 1);
                measure.tick = previous.tick + previous.ticks;
            }
            score.measures.add(measure);
        }
        while (measure.staves.size() < score.staves.size()) measure.staves.add(new StaffMeasure());
        StaffMeasure staffMeasure = measure.staves.get(staffIndex);

        for (Element timeSig : descendants(element, "TimeSig")) {
            if (intValue(child(timeSig, "isCourtesy"), 0) != 0) continue;
            timeN = intValue(child(timeSig, "sigN"), timeN); timeD = intValue(child(timeSig, "sigD"), timeD);
            if (staffIndex == 0 || !measure.timeChange) {
                measure.timeChange = true;
                measure.timeSymbol = intValue(child(timeSig, "subtype"), 0);
            }
            break;
        }
        if (staffIndex == 0 || measure.ticks == 0) {
            measure.timeN = timeN; measure.timeD = timeD;
            String length = element.getAttribute("len");
            measure.ticks = length.isEmpty() ? fractionTicks(timeN + "/" + timeD) : fractionTicks(length);
        }
        if (child(element, "irregular") != null) measure.irregular = true;
        if (child(element, "startRepeat") != null) measure.startRepeat = true;
        Element endRepeat = child(element, "endRepeat");
        if (endRepeat != null) measure.endRepeat = Math.max(2, intValue(endRepeat, 2));
        applyLayoutBreaks(element, measure);

        List<Element> voices = children(element, "voice");
        if (voices.isEmpty()) readVoice(element, 0, measure, measureIndex, staffMeasure, staffIndex, true);
        else for (int voice = 0; voice < voices.size(); voice++)
            readVoice(voices.get(voice), voice, measure, measureIndex, staffMeasure, staffIndex, false);
    }

    private void applyLayoutBreaks(Element element, Measure measure) {
        for (Element layoutBreak : children(element, "LayoutBreak")) {
            String type = text(layoutBreak, "subtype");
            if (type.equals("page")) measure.pageBreak = true;
            else if (type.equals("line") || type.equals("section")) measure.lineBreak = true;
        }
    }

    private void readVoice(Element container, int voice, Measure measure, int measureIndex, StaffMeasure staffMeasure,
                           int staffIndex, boolean legacy) {
        StaffContext context = contexts.get(staffIndex);
        int cursor = measure.tick;
        ArrayDeque<Tuplet> tuplets = new ArrayDeque<>();
        List<ChordRest> graces = new ArrayList<>();
        String fermata = null;
        ChordRest last = null;
        for (Element element : children(container)) {
            switch (element.getTagName()) {
                case "location":
                    cursor += fractionTicks(text(element, "fractions"));
                    break;
                case "tick":
                    cursor = intValue(element, cursor);
                    break;
                case "Chord": case "Rest": {
                    ChordRest chordRest = readChordRest(element, cursor, voice, measure, measureIndex, staffIndex, context, tuplets);
                    if (chordRest.grace) { graces.add(chordRest); break; }
                    chordRest.graces.addAll(graces); graces.clear();
                    if (fermata != null) { chordRest.fermata = fermata; fermata = null; }
                    staffMeasure.chordRests.add(chordRest);
                    cursor += chordRest.duration;
                    last = chordRest;
                    break;
                }
                case "Tuplet": {
                    Tuplet tuplet = new Tuplet();
                    tuplet.normal = Math.max(1, intValue(child(element, "normalNotes"), 2));
                    tuplet.actual = Math.max(1, intValue(child(element, "actualNotes"), 3));
                    tuplet.showNumber = intValue(child(element, "numberType"), 0) != 2 && intValue(child(element, "visible"), 1) != 0;
                    String id = element.getAttribute("id");
                    if (legacy && !id.isEmpty()) legacyTuplets.put(staffIndex + ":" + id, tuplet);
                    else tuplets.push(tuplet);
                    break;
                }
                case "endTuplet":
                    if (!tuplets.isEmpty()) tuplets.pop();
                    break;
                case "KeySig":
                    if (intValue(child(element, "isCourtesy"), 0) == 0) staffMeasure.key = readKey(element, context);
                    break;
                case "Clef":
                    if (intValue(child(element, "isCourtesy"), 0) == 0) {
                        String clef = readClef(element);
                        if (clef != null) staffMeasure.clefs.add(new ClefChange(cursor, clef));
                    }
                    break;
                case "Fermata":
                    fermata = text(element, "subtype").toLowerCase(Locale.ROOT).contains("below") ? "fermataBelow" : "fermataAbove";
                    break;
                case "Breath":
                    if (last != null) last.breath = true;
                    break;
                case "BarLine": {
                    String type = barlineType(text(element, "subtype"));
                    if (cursor > measure.tick && (staffIndex == 0 || measure.endBarline == null)) measure.endBarline = type;
                    break;
                }
                case "Spanner":
                    readSpanner(element, null, cursor, measureIndex, staffIndex, voice);
                    break;
                case "HairPin": case "Volta":
                    if (legacy) startLegacySpanner(element, cursor, measure, staffIndex, voice);
                    break;
                case "Slur":
                    break;
                case "endSpanner": {
                    Spanner spanner = legacySpanners.remove(element.getAttribute("id"));
                    // MuseScore 2 ends a volta inside the last measure it covers.
                    if (spanner != null) spanner.endTick = spanner.kind == Spanner.VOLTA ? measure.tick + measure.ticks : cursor;
                    break;
                }
                default:
                    readAnnotation(element, cursor, measure, staffMeasure);
            }
        }
        if (!graces.isEmpty() && last != null) last.graces.addAll(graces);
    }

    private ChordRest readChordRest(Element element, int tick, int voice, Measure measure, int measureIndex, int staffIndex,
                                    StaffContext context, ArrayDeque<Tuplet> tuplets) {
        ChordRest chordRest = new ChordRest();
        chordRest.rest = element.getTagName().equals("Rest");
        chordRest.tick = tick; chordRest.voice = voice;
        int track = intValue(child(element, "track"), -1);
        if (track >= 0) chordRest.voice = track % 4;
        String type = text(element, "durationType");
        chordRest.dots = intValue(child(element, "dots"), 0);
        if (type.equals("measure")) {
            chordRest.measureRest = true;
            String duration = text(element, "duration");
            chordRest.duration = duration.isEmpty() ? measure.ticks : fractionTicks(duration);
            chordRest.value = 1;
        } else {
            chordRest.value = durationValue(type);
            int base = chordRest.value == 0 ? score.division * 8 : score.division * 4 / chordRest.value;
            int duration = base, dot = base;
            for (int i = 0; i < chordRest.dots; i++) { dot /= 2; duration += dot; }
            chordRest.duration = duration;
        }
        for (String grace : new String[]{"acciaccatura", "appoggiatura", "grace4", "grace8after", "grace16", "grace16after", "grace32", "grace32after"})
            if (child(element, grace) != null) chordRest.grace = true;
        if (chordRest.grace) chordRest.duration = 0;
        chordRest.small = intValue(child(element, "small"), 0) != 0;
        chordRest.visible = intValue(child(element, "visible"), 1) != 0;
        String stem = text(element, "StemDirection");
        chordRest.stemDirection = stem.equals("up") ? 1 : stem.equals("down") ? -1 : 0;
        String beamMode = text(element, "BeamMode");
        if (!beamMode.isEmpty()) chordRest.beamMode = beamMode.startsWith("begin") && !beamMode.equals("begin") ? "mid" : beamMode;
        chordRest.beamId = intValue(child(element, "Beam"), -1);

        Tuplet tuplet = null;
        Element legacyTuplet = child(element, "Tuplet");
        if (legacyTuplet != null) tuplet = legacyTuplets.get(staffIndex + ":" + legacyTuplet.getTextContent().trim());
        if (tuplet == null && !tuplets.isEmpty()) tuplet = tuplets.peek();
        if (tuplet != null && !chordRest.grace) {
            chordRest.tuplet = tuplet; tuplet.members.add(chordRest);
            long duration = chordRest.duration;
            if (tuplets.isEmpty()) duration = duration * tuplet.normal / tuplet.actual;
            else for (Tuplet nested : tuplets) duration = duration * nested.normal / nested.actual;
            chordRest.duration = (int) duration;
        }

        for (Element child : children(element)) {
            switch (child.getTagName()) {
                case "Note": {
                    Note note = readNote(child, context);
                    if (note != null) chordRest.notes.add(note);
                    break;
                }
                case "Articulation": case "Ornament": {
                    String articulation = articulationName(text(child, "subtype"));
                    if (articulation == null) break;
                    if (articulation.startsWith("fermata")) chordRest.fermata = articulation;
                    else chordRest.articulations.add(articulation);
                    break;
                }
                case "Lyrics": {
                    Lyric lyric = new Lyric();
                    lyric.verse = intValue(child(child, "no"), 0);
                    lyric.syllabic = text(child, "syllabic");
                    Element textElement = child(child, "text");
                    lyric.text = textElement == null ? "" : richText(textElement);
                    if (!lyric.text.isEmpty()) chordRest.lyrics.add(lyric);
                    break;
                }
                case "Spanner":
                    readSpanner(child, chordRest, tick, measureIndex, staffIndex, chordRest.voice);
                    break;
                case "Slur": {
                    String id = staffIndex + ":slur:" + child.getAttribute("id");
                    if ("start".equals(child.getAttribute("type"))) {
                        Spanner slur = new Spanner(); slur.kind = Spanner.SLUR; slur.staff = staffIndex;
                        slur.voice = chordRest.voice; slur.start = chordRest; slur.startTick = tick;
                        legacySpanners.put(id, slur); score.spanners.add(slur);
                    } else if ("stop".equals(child.getAttribute("type"))) {
                        Spanner slur = legacySpanners.remove(id);
                        if (slur != null) { slur.end = chordRest; slur.endTick = tick; }
                    }
                    break;
                }
                default:
            }
        }
        if (!chordRest.rest && chordRest.notes.isEmpty()) chordRest.rest = true;
        return chordRest;
    }

    private Note readNote(Element element, StaffContext context) {
        Note note = new Note();
        int pitch = intValue(child(element, "pitch"), -1);
        if (pitch < 0) return null;
        note.soundPitch = pitch;
        int tpc = intValue(child(element, "tpc"), 14);
        int tpc2 = intValue(child(element, "tpc2"), Integer.MIN_VALUE);
        if (context.transposed()) {
            note.pitch = pitch - context.transposeChromatic;
            note.tpc = tpc2 != Integer.MIN_VALUE ? tpc2 : tpc + context.fifths;
        } else { note.pitch = pitch; note.tpc = tpc; }
        String head = text(element, "head");
        if (head.equals("cross") || head.equals("1") || head.equals("x")) note.head = "cross";
        Element accidental = child(element, "Accidental");
        if (accidental != null && !context.transposed()) note.accidental = accidentalName(text(accidental, "subtype"));
        if (child(element, "Tie") != null) note.tieStart = true;
        for (Element spanner : children(element, "Spanner")) {
            if (!"Tie".equals(spanner.getAttribute("type"))) continue;
            if (child(spanner, "Tie") != null || child(spanner, "next") != null) note.tieStart = true;
            if (child(spanner, "prev") != null) note.tieEnd = true;
        }
        return note;
    }

    private void readSpanner(Element element, ChordRest chordRest, int tick, int measureIndex, int staffIndex, int voice) {
        String type = element.getAttribute("type");
        int kind;
        if (type.equals("Slur")) kind = Spanner.SLUR;
        else if (type.equals("HairPin")) kind = Spanner.CRESCENDO;
        else if (type.equals("Volta")) kind = Spanner.VOLTA;
        else return;
        Element body = child(element, type);
        Element next = child(element, "next");
        if (body == null || next == null) return;
        Spanner spanner = new Spanner();
        spanner.kind = kind; spanner.staff = staffIndex; spanner.voice = voice; spanner.startTick = tick; spanner.start = chordRest;
        if (kind == Spanner.CRESCENDO) {
            int subtype = intValue(child(body, "subtype"), 0);
            if (subtype == 1 || subtype == 3) spanner.kind = Spanner.DIMINUENDO;
        } else if (kind == Spanner.VOLTA) readVoltaDetails(body, spanner);
        Element location = child(next, "location");
        PendingSpanner entry = new PendingSpanner();
        entry.spanner = spanner; entry.startMeasure = measureIndex;
        if (location != null) {
            entry.measures = intValue(child(location, "measures"), 0);
            entry.fractionTicks = fractionTicks(text(location, "fractions"));
        }
        pending.add(entry);
        score.spanners.add(spanner);
    }

    private void startLegacySpanner(Element element, int tick, Measure measure, int staffIndex, int voice) {
        String id = element.getAttribute("id");
        if (id.isEmpty() || legacySpanners.containsKey(id)) return;
        Spanner spanner = new Spanner();
        spanner.staff = staffIndex; spanner.voice = voice;
        if (element.getTagName().equals("Volta")) {
            spanner.kind = Spanner.VOLTA; spanner.startTick = measure.tick;
            readVoltaDetails(element, spanner);
        } else {
            spanner.kind = intValue(child(element, "subtype"), 0) % 2 == 1 ? Spanner.DIMINUENDO : Spanner.CRESCENDO;
            spanner.startTick = tick;
        }
        spanner.endTick = -1;
        legacySpanners.put(id, spanner);
        score.spanners.add(spanner);
    }

    private void readVoltaDetails(Element volta, Spanner spanner) {
        String label = text(volta, "beginText");
        if (label.isEmpty()) label = text(volta, "text");
        if (label.isEmpty()) {
            String endings = text(volta, "endings");
            label = endings.isEmpty() ? "1." : endings.replace(" ", "").replace(",", ".,") + ".";
        }
        spanner.text = label;
        String hook = text(volta, "endHookType");
        spanner.endHook = hook.isEmpty() ? text(volta, "subtype").equals("1") || text(volta, "subtype").isEmpty() : !hook.equals("0");
    }

    private void readAnnotation(Element element, int tick, Measure measure, StaffMeasure staffMeasure) {
        if (element.getTagName().equals("Tempo")) {
            // Stored as quarter notes per second; hidden markings still set the playback tempo.
            float quarterPerSecond = floatValue(child(element, "tempo"), 0f);
            if (quarterPerSecond > 0) score.tempos.put(tick, quarterPerSecond * 60f);
        }
        if (intValue(child(element, "visible"), 1) == 0) return;
        String tag = element.getTagName();
        Element textElement = child(element, "text");
        String value = textElement == null ? "" : richText(textElement);
        int kind;
        switch (tag) {
            case "Dynamic": {
                String subtype = text(element, "subtype");
                value = subtype.isEmpty() || subtype.equals("other-dynamics") ? value : subtype;
                kind = Annotation.DYNAMIC; break;
            }
            case "StaffText": case "SystemText": case "InstrumentChange": case "PlayTechAnnotation":
                kind = text(element, "placement").equals("below") ? Annotation.TEXT_BELOW : Annotation.TEXT_ABOVE; break;
            case "Expression": kind = Annotation.TEXT_BELOW; break;
            case "RehearsalMark": kind = Annotation.REHEARSAL; break;
            case "Tempo": kind = Annotation.TEMPO; break;
            case "Harmony": {
                int root = intValue(child(element, "root"), Integer.MIN_VALUE);
                if (root == Integer.MIN_VALUE) return;
                value = tpcName(root) + text(element, "name");
                int base = intValue(child(element, "base"), Integer.MIN_VALUE);
                if (base != Integer.MIN_VALUE) value += "/" + tpcName(base);
                kind = Annotation.CHORD_SYMBOL; break;
            }
            case "Marker": {
                String subtype = text(element, "subtype").toLowerCase(Locale.ROOT);
                if (subtype.contains("segno")) { kind = Annotation.SEGNO; value = ""; }
                else if (subtype.equals("coda") || subtype.equals("varcoda") || subtype.equals("codetta")) { kind = Annotation.CODA; value = ""; }
                else {
                    kind = Annotation.TEXT_ABOVE;
                    if (value.isEmpty()) value = subtype.equals("fine") ? "Fine" : subtype.equals("tocoda") ? "To Coda" : "";
                    if (subtype.equals("fine") || subtype.equals("tocoda")) tick = measure.tick + measure.ticks;
                }
                break;
            }
            case "Jump":
                kind = Annotation.TEXT_ABOVE; tick = measure.tick + measure.ticks; break;
            default:
                return;
        }
        if (value.trim().isEmpty() && kind != Annotation.SEGNO && kind != Annotation.CODA) return;
        staffMeasure.annotations.add(new Annotation(kind, tick, value.trim()));
    }

    private Integer readKey(Element element, StaffContext context) {
        if (child(element, "custom") != null && child(element, "concertKey") == null && child(element, "accidental") == null) return 0;
        Element concert = child(element, "concertKey");
        int key;
        if (concert != null) {
            int concertKey = intValue(concert, 0);
            Element actual = child(element, "actualKey");
            key = concertPitch ? concertKey : actual != null ? intValue(actual, concertKey) : concertKey + context.fifths;
        } else {
            // Older files store the key as displayed for the transposing instrument.
            int written = intValue(child(element, "accidental"), intValue(child(element, "subtype"), 0));
            key = concertPitch ? written - transposeFifths(context.transposeChromatic, context.transposeDiatonic) : written;
        }
        while (key > 7) key -= 12;
        while (key < -7) key += 12;
        return key;
    }

    private String readClef(Element element) {
        String concert = text(element, "concertClefType"), transposing = text(element, "transposingClefType");
        String value = !concertPitch && !transposing.isEmpty() ? transposing : !concert.isEmpty() ? concert : text(element, "subtype");
        return value.isEmpty() ? null : clefName(value);
    }

    private void finish() {
        for (Measure measure : score.measures) while (measure.staves.size() < score.staves.size()) measure.staves.add(new StaffMeasure());
        for (int i = 0; i < score.staves.size(); i++) score.staves.get(i).clef = contexts.get(i).defaultClef;
        for (PendingSpanner entry : pending) {
            Spanner spanner = entry.spanner;
            int target = Math.max(0, Math.min(score.measures.size() - 1, entry.startMeasure + entry.measures));
            int startMeasureTick = score.measures.get(Math.min(entry.startMeasure, score.measures.size() - 1)).tick;
            int targetTick = entry.startMeasure + entry.measures >= score.measures.size()
                    ? score.measures.get(score.measures.size() - 1).tick + score.measures.get(score.measures.size() - 1).ticks
                    : score.measures.get(target).tick;
            spanner.endTick = targetTick + (spanner.startTick - startMeasureTick) + entry.fractionTicks;
        }
        for (Spanner spanner : score.spanners) {
            if (spanner.endTick < spanner.startTick) {
                Measure last = score.measures.get(score.measures.size() - 1);
                spanner.endTick = spanner.kind == Spanner.VOLTA ? last.tick + last.ticks : Math.max(spanner.startTick, last.tick + last.ticks);
            }
            if (spanner.kind == Spanner.SLUR && spanner.end == null) spanner.end = chordAt(spanner.staff, spanner.voice, spanner.endTick);
            if (spanner.kind == Spanner.SLUR && spanner.start == null) spanner.start = chordAt(spanner.staff, spanner.voice, spanner.startTick);
        }
        for (int i = score.spanners.size() - 1; i >= 0; i--) {
            Spanner spanner = score.spanners.get(i);
            if (spanner.kind == Spanner.SLUR && (spanner.start == null || spanner.end == null || spanner.start == spanner.end)) score.spanners.remove(i);
        }
        linkTies();
        int number = 1;
        for (int i = 0; i < score.measures.size(); i++) {
            Measure measure = score.measures.get(i);
            boolean pickup = i == 0 && measure.ticks < fractionTicks(measure.timeN + "/" + measure.timeD);
            measure.number = number;
            if (!measure.irregular && !pickup) number++;
        }
        if (!score.measures.isEmpty()) {
            Measure last = score.measures.get(score.measures.size() - 1);
            if (last.endBarline == null && last.endRepeat == 0) last.endBarline = "end";
        }
    }

    private ChordRest chordAt(int staff, int voice, int tick) {
        ChordRest best = null;
        for (Measure measure : score.measures) {
            if (measure.tick > tick) break;
            for (ChordRest chordRest : measure.staves.get(staff).chordRests) {
                if (chordRest.rest || chordRest.tick > tick) continue;
                if (chordRest.voice == voice && (best == null || chordRest.tick >= best.tick)) best = chordRest;
            }
        }
        return best;
    }

    private void linkTies() {
        for (int staff = 0; staff < score.staves.size(); staff++) {
            for (int voice = 0; voice < 4; voice++) {
                List<ChordRest> chords = new ArrayList<>();
                for (Measure measure : score.measures)
                    for (ChordRest chordRest : measure.staves.get(staff).chordRests)
                        if (chordRest.voice == voice && !chordRest.rest) chords.add(chordRest);
                Collections.sort(chords, (a, b) -> Integer.compare(a.tick, b.tick));
                for (int i = 0; i + 1 < chords.size(); i++) {
                    for (Note note : chords.get(i).notes) {
                        Note target = null;
                        for (Note candidate : chords.get(i + 1).notes) if (candidate.pitch == note.pitch) target = candidate;
                        if (target != null && (note.tieStart || target.tieEnd)) { note.tieTo = target; target.tieEnd = true; }
                    }
                }
            }
        }
    }

    // ---- value conversion -------------------------------------------------------------------------------------

    private int fractionTicks(String fraction) {
        if (fraction == null || fraction.isEmpty()) return 0;
        int slash = fraction.indexOf('/');
        try {
            if (slash < 0) return Integer.parseInt(fraction.trim()) * score.division * 4;
            long numerator = Long.parseLong(fraction.substring(0, slash).trim());
            long denominator = Long.parseLong(fraction.substring(slash + 1).trim());
            return denominator == 0 ? 0 : (int) (numerator * score.division * 4 / denominator);
        } catch (NumberFormatException e) { return 0; }
    }

    private static int durationValue(String type) {
        switch (type) {
            case "long": case "breve": return 0;
            case "whole": return 1;
            case "half": return 2;
            case "eighth": return 8;
            case "16th": return 16;
            case "32nd": return 32;
            case "64th": return 64;
            case "128th": return 128;
            default: return 4;
        }
    }

    /** Number of fifths the written key lies above the concert key for an instrument transposition. */
    static int transposeFifths(int chromatic, int diatonic) {
        int up = Math.floorMod(-chromatic, 12), steps = Math.floorMod(-diatonic, 7);
        int best = 0, bestScore = Integer.MAX_VALUE;
        for (int fifths = -12; fifths <= 12; fifths++) {
            if (Math.floorMod(fifths * 7, 12) != up) continue;
            int score = Math.abs(fifths) + (Math.floorMod(fifths * 4, 7) == steps ? 0 : 100);
            if (score < bestScore) { bestScore = score; best = fifths; }
        }
        return best;
    }

    private static String clefName(String value) {
        switch (value) {
            case "0": return "G";
            case "1": return "G8va";
            case "2": return "G15ma";
            case "3": return "G8vb";
            case "4": return "F";
            case "5": return "F8vb";
            case "6": return "F15mb";
            case "7": return "F3";
            case "9": return "C1";
            case "10": return "C2";
            case "11": return "C3";
            case "12": return "C4";
            case "14": case "15": return "PERC";
            case "G3": case "G1": return "G";
            case "PERC2": case "TAB": case "TAB2": case "TAB4": case "TAB_SERIF": case "TAB4_SERIF": return "PERC";
            default: return value;
        }
    }

    private static String barlineType(String subtype) {
        switch (subtype) {
            case "double": case "2": return "double";
            case "end": case "final": case "5": return "end";
            case "dashed": case "1": return "dashed";
            case "dotted": return "dotted";
            case "heavy": case "double-heavy": return "heavy";
            case "reverse-end": return "reverse-end";
            case "end-repeat": return "end-repeat";
            default: return null;
        }
    }

    private static String articulationName(String subtype) {
        String s = subtype.toLowerCase(Locale.ROOT);
        if (s.contains("fermata")) return s.contains("below") ? "fermataBelow" : "fermataAbove";
        if (s.contains("staccatissimo")) return "articStaccatissimo";
        if (s.contains("marcato") || s.contains("strongaccent")) return s.contains("staccato") ? "articMarcatoStaccato" : "articMarcato";
        if (s.contains("accent") || s.contains("sforzato")) return s.contains("staccato") ? "articAccentStaccato" : "articAccent";
        if (s.contains("tenuto") || s.contains("portato")) return s.contains("staccato") || s.contains("portato") ? "articTenutoStaccato" : "articTenuto";
        if (s.contains("staccato")) return "articStaccato";
        if (s.contains("shorttrill") || s.contains("prall")) return "ornamentShortTrill";
        if (s.contains("trill")) return "ornamentTrill";
        if (s.contains("mordent")) return "ornamentMordent";
        if (s.contains("turn")) return "ornamentTurn";
        if (s.contains("muteclosed") || s.contains("plusstop")) return "brassMuteClosed";
        if (s.contains("muteopen") || s.equals("ouvert")) return "brassMuteOpen";
        return null;
    }

    private static String accidentalName(String subtype) {
        switch (subtype) {
            case "sharp": case "accidentalSharp": case "1": return "accidentalSharp";
            case "flat": case "accidentalFlat": case "2": return "accidentalFlat";
            case "natural": case "accidentalNatural": case "5": return "accidentalNatural";
            case "double sharp": case "accidentalDoubleSharp": case "3": return "accidentalDoubleSharp";
            case "double flat": case "accidentalDoubleFlat": case "4": return "accidentalDoubleFlat";
            default: return null;
        }
    }

    static String tpcName(int tpc) {
        String letter = String.valueOf("FCGDAEB".charAt(Math.floorMod(tpc - 13, 7)));
        int alter = Math.floorDiv(tpc - 13, 7);
        StringBuilder name = new StringBuilder(letter);
        for (int i = 0; i < alter; i++) name.append('♯');
        for (int i = 0; i > alter; i--) name.append('♭');
        return name.toString();
    }

    // ---- XML helpers ------------------------------------------------------------------------------------------

    /** Text content with MuseScore's {@code <sym>} elements replaced by SMuFL characters. */
    private static String richText(Element element) {
        StringBuilder text = new StringBuilder();
        appendRichText(element, text);
        return text.toString().replace(' ', ' ').trim();
    }

    private static void appendRichText(Node node, StringBuilder text) {
        for (Node child = node.getFirstChild(); child != null; child = child.getNextSibling()) {
            if (child.getNodeType() == Node.TEXT_NODE || child.getNodeType() == Node.CDATA_SECTION_NODE) text.append(child.getNodeValue());
            else if (child.getNodeType() == Node.ELEMENT_NODE) {
                Element element = (Element) child;
                if (element.getTagName().equals("sym")) {
                    char symbol = Glyphs.symbolForName(element.getTextContent().trim());
                    if (symbol != 0) text.append(symbol);
                } else appendRichText(element, text);
            }
        }
    }

    private static Map<String, byte[]> unzip(byte[] data) throws IOException {
        Map<String, byte[]> entries = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(data))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                String lower = name.toLowerCase(Locale.ROOT);
                if (entry.isDirectory() || !(lower.endsWith(".mscx") || lower.endsWith(".mss") || lower.endsWith("container.xml"))) continue;
                entries.put(name, readAll(zip, 32 * 1024 * 1024));
            }
        }
        return entries;
    }

    static byte[] readAll(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[32 * 1024];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
            if (output.size() > limit) throw new IOException("Datei ist zu groß");
        }
        return output.toByteArray();
    }

    private static Document parseXml(byte[] data) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        try { factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true); } catch (Exception ignored) { }
        factory.setExpandEntityReferences(false);
        DocumentBuilder builder = factory.newDocumentBuilder();
        return builder.parse(new ByteArrayInputStream(data));
    }

    private static List<Element> children(Element parent) {
        List<Element> result = new ArrayList<>();
        if (parent == null) return result;
        for (Node node = parent.getFirstChild(); node != null; node = node.getNextSibling())
            if (node.getNodeType() == Node.ELEMENT_NODE) result.add((Element) node);
        return result;
    }

    private static List<Element> children(Element parent, String tag) {
        List<Element> result = new ArrayList<>();
        for (Element element : children(parent)) if (element.getTagName().equals(tag)) result.add(element);
        return result;
    }

    private static Element child(Element parent, String tag) {
        if (parent == null) return null;
        for (Node node = parent.getFirstChild(); node != null; node = node.getNextSibling())
            if (node.getNodeType() == Node.ELEMENT_NODE && ((Element) node).getTagName().equals(tag)) return (Element) node;
        return null;
    }

    private static List<Element> descendants(Element parent, String tag) {
        List<Element> result = new ArrayList<>();
        org.w3c.dom.NodeList nodes = parent.getElementsByTagName(tag);
        for (int i = 0; i < nodes.getLength(); i++) result.add((Element) nodes.item(i));
        return result;
    }

    private static String text(Element parent, String tag) {
        Element element = child(parent, tag);
        return element == null ? "" : element.getTextContent().trim();
    }

    private static int intValue(Element element, int fallback) {
        return element == null ? fallback : parseInt(element.getTextContent(), fallback);
    }

    private static int parseInt(String value, int fallback) {
        try { return Integer.parseInt(value.trim()); } catch (Exception e) { return fallback; }
    }

    private static float floatValue(Element element, float fallback) {
        if (element == null) return fallback;
        try { return Float.parseFloat(element.getTextContent().trim()); } catch (Exception e) { return fallback; }
    }
}
