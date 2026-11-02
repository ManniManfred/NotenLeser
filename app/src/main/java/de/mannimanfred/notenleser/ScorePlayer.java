package de.mannimanfred.notenleser;

import android.content.Context;
import android.media.MediaPlayer;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import de.mannimanfred.notenleser.MusicModel.Annotation;
import de.mannimanfred.notenleser.MusicModel.ChordRest;
import de.mannimanfred.notenleser.MusicModel.Measure;
import de.mannimanfred.notenleser.MusicModel.Note;
import de.mannimanfred.notenleser.MusicModel.Score;
import de.mannimanfred.notenleser.MusicModel.Spanner;
import de.mannimanfred.notenleser.MusicModel.Staff;
import de.mannimanfred.notenleser.MusicModel.StaffMeasure;

/**
 * Plays a score through Android's built-in MIDI synthesizer. Repeats and voltas are unfolded; the
 * generated MIDI file uses one tick per millisecond so the player position maps directly to score time.
 */
final class ScorePlayer {
    private static final float DEFAULT_TEMPO = 120f;

    /** One played occurrence of a measure. */
    private static final class Played {
        final Measure measure; final double startMs, endMs;
        Played(Measure measure, double startMs, double endMs) { this.measure = measure; this.startMs = startMs; this.endMs = endMs; }
    }

    private static final class NoteEvent {
        final int channel, pitch, velocity; final double start; double end;
        NoteEvent(int channel, int pitch, int velocity, double start, double end) {
            this.channel = channel; this.pitch = pitch; this.velocity = velocity; this.start = start; this.end = end;
        }
    }

    private final Score score;
    private final TreeMap<Integer, Float> tempos;
    private List<Played> timeline = new ArrayList<>();
    private float speed = 1f;
    private MediaPlayer mediaPlayer;
    private double offsetMs;
    private File midiFile;

    ScorePlayer(Score score) {
        this.score = score;
        tempos = new TreeMap<>(score.tempos);
        if (tempos.isEmpty() || tempos.firstKey() > 0) tempos.put(0, tempos.isEmpty() ? DEFAULT_TEMPO : tempos.firstEntry().getValue());
    }

    boolean isPlaying() { return mediaPlayer != null; }

    /** Starts playing at a score tick with a tempo factor (1 = as written); onEnd runs on the main thread. */
    void start(Context context, int startTick, float speed, Runnable onEnd) throws IOException {
        stop();
        this.speed = Math.max(.25f, Math.min(2f, speed));
        timeline = unfold();
        if (timeline.isEmpty()) throw new IOException("Die Partitur enthält nichts zum Abspielen");
        double startMs = 0;
        for (Played played : timeline) {
            Measure m = played.measure;
            if (startTick >= m.tick && startTick < m.tick + m.ticks) { startMs = msAt(played, startTick); break; }
        }
        offsetMs = startMs;
        byte[] midi = buildMidi(startMs);
        midiFile = new File(context.getCacheDir(), "notenleser_playback.mid");
        try (FileOutputStream output = new FileOutputStream(midiFile)) { output.write(midi); }
        MediaPlayer player = new MediaPlayer();
        try {
            player.setDataSource(midiFile.getAbsolutePath());
            player.prepare();
        } catch (IOException | RuntimeException e) {
            player.release();
            throw e instanceof IOException ? (IOException) e : new IOException(e.getMessage(), e);
        }
        player.setOnCompletionListener(p -> { stop(); if (onEnd != null) onEnd.run(); });
        mediaPlayer = player;
        player.start();
    }

    void stop() {
        if (mediaPlayer != null) {
            try { mediaPlayer.stop(); } catch (IllegalStateException ignored) { }
            mediaPlayer.release();
            mediaPlayer = null;
        }
    }

    /** Score tick currently sounding, or -1 when not playing. */
    int currentTick() {
        if (mediaPlayer == null) return -1;
        double ms;
        try { ms = offsetMs + mediaPlayer.getCurrentPosition(); } catch (IllegalStateException e) { return -1; }
        return tickAtMs(ms);
    }

    // ---- timing -----------------------------------------------------------------------------------------------

    private double msPerTick(float bpm) { return 60000.0 / (bpm * score.division * speed); }

    /** Milliseconds between two ticks of the score following the tempo map. */
    private double duration(int fromTick, int toTick) {
        double ms = 0;
        int t = fromTick;
        while (t < toTick) {
            float bpm = tempos.floorEntry(t).getValue();
            Integer next = tempos.higherKey(t);
            int end = next == null ? toTick : Math.min(toTick, next);
            ms += (end - t) * msPerTick(bpm);
            t = end;
        }
        return ms;
    }

    private double msAt(Played played, int tick) { return played.startMs + duration(played.measure.tick, tick); }

    private int tickAtMs(double ms) {
        int low = 0, high = timeline.size() - 1;
        if (high < 0) return -1;
        while (low < high) {
            int mid = (low + high + 1) / 2;
            if (timeline.get(mid).startMs <= ms) low = mid; else high = mid - 1;
        }
        Played played = timeline.get(low);
        Measure m = played.measure;
        double rest = Math.max(0, ms - played.startMs);
        int t = m.tick, end = m.tick + m.ticks;
        while (t < end) {
            float bpm = tempos.floorEntry(t).getValue();
            Integer next = tempos.higherKey(t);
            int segmentEnd = next == null ? end : Math.min(end, next);
            double segmentMs = (segmentEnd - t) * msPerTick(bpm);
            if (rest < segmentMs) return t + (int) (rest / msPerTick(bpm) + 1e-6);
            rest -= segmentMs;
            t = segmentEnd;
        }
        return Math.max(m.tick, end - 1);
    }

    // ---- repeats ----------------------------------------------------------------------------------------------

    private static final Pattern NUMBER = Pattern.compile("\\d+");

    /** Volta endings covering each measure, or null for measures outside voltas. */
    private Map<Measure, Set<Integer>> voltaEndings() {
        Map<Measure, Set<Integer>> result = new HashMap<>();
        for (Spanner spanner : score.spanners) {
            if (spanner.kind != Spanner.VOLTA) continue;
            Set<Integer> endings = new HashSet<>();
            List<Integer> numbers = new ArrayList<>();
            Matcher matcher = NUMBER.matcher(spanner.text == null ? "" : spanner.text);
            while (matcher.find()) numbers.add(Integer.parseInt(matcher.group()));
            if (numbers.size() == 2 && spanner.text.matches(".*\\d\\s*[-–]\\s*\\d.*"))
                for (int n = numbers.get(0); n <= numbers.get(1); n++) endings.add(n);
            else endings.addAll(numbers);
            if (endings.isEmpty()) endings.add(1);
            for (Measure m : score.measures)
                if (m.tick >= spanner.startTick && m.tick < spanner.endTick) result.put(m, endings);
        }
        return result;
    }

    private List<Played> unfold() {
        List<Played> result = new ArrayList<>();
        Map<Measure, Set<Integer>> voltas = voltaEndings();
        int n = score.measures.size();
        int[] counts = new int[n];
        int i = 0, repeatStart = 0, pass = 1, guard = 0;
        boolean jumped = false;
        double ms = 0;
        while (i < n && guard++ < n * 20) {
            Measure m = score.measures.get(i);
            if (m.startRepeat && !jumped) { repeatStart = i; pass = 1; }
            jumped = false;
            Set<Integer> endings = voltas.get(m);
            if (endings != null && !endings.contains(pass)) { i++; continue; }
            double length = duration(m.tick, m.tick + m.ticks);
            result.add(new Played(m, ms, ms + length));
            ms += length;
            if (m.endRepeat > 0) {
                counts[i]++;
                if (counts[i] < m.endRepeat) { pass++; i = repeatStart; jumped = true; continue; }
                counts[i] = 0;
                repeatStart = i + 1;
            }
            i++;
        }
        return result;
    }

    // ---- MIDI -------------------------------------------------------------------------------------------------

    private static int velocity(String dynamic) {
        String d = dynamic == null ? "" : dynamic.toLowerCase(Locale.ROOT).replaceAll("[^a-z]", "");
        switch (d) {
            case "pppp": return 20;
            case "ppp": return 30;
            case "pp": return 42;
            case "p": return 56;
            case "mp": return 70;
            case "mf": return 84;
            case "f": return 98;
            case "ff": return 110;
            case "fff": return 120;
            case "ffff": return 126;
            default: return -1;
        }
    }

    private byte[] buildMidi(double startMs) {
        int staffCount = score.staves.size();
        int[] channels = new int[staffCount];
        Map<Integer, Integer> partChannels = new HashMap<>();
        Map<Integer, Integer> programs = new TreeMap<>();
        for (int s = 0; s < staffCount; s++) {
            Staff staff = score.staves.get(s);
            if ("PERC".equals(staff.clef)) { channels[s] = 9; continue; }
            Integer channel = partChannels.get(staff.part);
            if (channel == null) {
                int next = partChannels.size() % 15;
                channel = next >= 9 ? next + 1 : next;
                partChannels.put(staff.part, channel);
            }
            channels[s] = channel;
            if (!programs.containsKey(channel)) programs.put(channel, staff.program);
        }
        // Dynamics per staff by tick.
        List<TreeMap<Integer, Integer>> dynamics = new ArrayList<>();
        for (int s = 0; s < staffCount; s++) {
            TreeMap<Integer, Integer> map = new TreeMap<>();
            for (Measure m : score.measures) {
                if (s >= m.staves.size()) continue;
                for (Annotation annotation : m.staves.get(s).annotations) {
                    if (annotation.kind != Annotation.DYNAMIC) continue;
                    int v = velocity(annotation.text);
                    if (v > 0) map.put(annotation.tick, v);
                }
            }
            dynamics.add(map);
        }

        List<NoteEvent> notes = new ArrayList<>();
        List<Map<Integer, NoteEvent>> openTies = new ArrayList<>();
        for (int s = 0; s < staffCount; s++) openTies.add(new HashMap<>());
        for (Played played : timeline) {
            Measure m = played.measure;
            for (int s = 0; s < staffCount && s < m.staves.size(); s++) {
                StaffMeasure staffMeasure = m.staves.get(s);
                List<ChordRest> ordered = new ArrayList<>(staffMeasure.chordRests);
                Collections.sort(ordered, (a, b) -> Integer.compare(a.tick, b.tick));
                Map<Integer, NoteEvent> ties = openTies.get(s);
                for (ChordRest cr : ordered) {
                    if (cr.rest || cr.grace || cr.notes.isEmpty()) continue;
                    double start = msAt(played, cr.tick), end = msAt(played, cr.tick + cr.duration);
                    Map.Entry<Integer, Integer> dyn = dynamics.get(s).floorEntry(cr.tick);
                    int vel = dyn == null ? 84 : dyn.getValue();
                    boolean staccato = false;
                    for (String articulation : cr.articulations) {
                        if (articulation.contains("Accent") || articulation.contains("Marcato")) vel = Math.min(127, vel + 16);
                        if (articulation.contains("Staccato")) staccato = true;
                    }
                    double length = end - start;
                    double soundEnd = staccato ? start + length * .5 : end - Math.min(25, length * .08);
                    for (Note note : cr.notes) {
                        int pitch = Math.max(0, Math.min(127, note.soundPitch));
                        NoteEvent tied = note.tieEnd ? ties.get(pitch) : null;
                        if (tied != null) {
                            tied.end = soundEnd;
                            if (!note.tieStart) ties.remove(pitch);
                            continue;
                        }
                        NoteEvent event = new NoteEvent(channels[s], pitch, vel, start, Math.max(start + 10, soundEnd));
                        notes.add(event);
                        if (note.tieStart) ties.put(pitch, event); else ties.remove(pitch);
                    }
                }
            }
        }

        // Raw events: {time ms, order, status, data1, data2}; note-offs sort before note-ons at the same time.
        List<int[]> events = new ArrayList<>();
        for (NoteEvent note : notes) {
            if (note.start < startMs - 1) continue;
            int on = (int) Math.round(note.start - startMs), off = (int) Math.round(note.end - startMs);
            events.add(new int[]{on, 1, 0x90 | note.channel, note.pitch, note.velocity});
            events.add(new int[]{Math.max(on + 1, off), 0, 0x80 | note.channel, note.pitch, 0});
        }
        Collections.sort(events, (a, b) -> a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]));

        ByteArrayOutputStream track = new ByteArrayOutputStream();
        // Tempo of 1,000,000 µs per quarter with 1000 ticks per quarter: one tick per millisecond.
        writeVarLen(track, 0); track.write(0xFF); track.write(0x51); track.write(3);
        track.write(0x0F); track.write(0x42); track.write(0x40);
        for (Map.Entry<Integer, Integer> entry : programs.entrySet()) {
            writeVarLen(track, 0); track.write(0xC0 | entry.getKey()); track.write(entry.getValue());
            writeVarLen(track, 0); track.write(0xB0 | entry.getKey()); track.write(7); track.write(100);
        }
        int time = 0;
        for (int[] event : events) {
            writeVarLen(track, event[0] - time); time = event[0];
            track.write(event[2]); track.write(event[3]); track.write(event[4]);
        }
        writeVarLen(track, 200); track.write(0xFF); track.write(0x2F); track.write(0);

        byte[] trackBytes = track.toByteArray();
        ByteArrayOutputStream file = new ByteArrayOutputStream();
        writeAscii(file, "MThd"); writeInt(file, 6); writeShort(file, 0); writeShort(file, 1); writeShort(file, 1000);
        writeAscii(file, "MTrk"); writeInt(file, trackBytes.length);
        file.write(trackBytes, 0, trackBytes.length);
        return file.toByteArray();
    }

    private static void writeVarLen(ByteArrayOutputStream out, int value) {
        value = Math.max(0, value);
        int buffer = value & 0x7F;
        while ((value >>= 7) > 0) { buffer <<= 8; buffer |= ((value & 0x7F) | 0x80); }
        while (true) {
            out.write(buffer & 0xFF);
            if ((buffer & 0x80) != 0) buffer >>>= 8; else break;
        }
    }

    private static void writeAscii(ByteArrayOutputStream out, String text) { for (char c : text.toCharArray()) out.write(c); }

    private static void writeInt(ByteArrayOutputStream out, int value) {
        out.write(value >>> 24); out.write((value >>> 16) & 0xFF); out.write((value >>> 8) & 0xFF); out.write(value & 0xFF);
    }

    private static void writeShort(ByteArrayOutputStream out, int value) { out.write((value >>> 8) & 0xFF); out.write(value & 0xFF); }
}
