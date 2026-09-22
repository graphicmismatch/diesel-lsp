import Petroleum.Graph.*;
import Petroleum.Oscillators.OscillatorFactory;
import java.util.*;

public class Catalog {
    static String esc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }
    public static void main(String[] a) {
        NodeFactory f = new NodeFactory();
        List<String> names = new ArrayList<>(f.names());
        Collections.sort(names);
        StringBuilder out = new StringBuilder("{\n  \"nodes\": {\n");
        for (int i = 0; i < names.size(); i++) {
            String name = names.get(i);
            Node n;
            try { n = f.create(name); } catch (RuntimeException ex) { continue; }
            StringBuilder in = new StringBuilder();
            for (Port p : n.getInputPorts()) {
                if (in.length() > 0) in.append(", ");
                in.append("{\"name\": \"").append(esc(p.name())).append("\", \"default\": ").append(p.defaultValue()).append("}");
            }
            StringBuilder o = new StringBuilder();
            for (String s : n.getOutputPorts()) {
                if (o.length() > 0) o.append(", ");
                o.append("\"").append(esc(s)).append("\"");
            }
            out.append("    \"").append(esc(name)).append("\": {\"inputs\": [").append(in)
               .append("], \"outputs\": [").append(o).append("]}");
            out.append(i < names.size() - 1 ? ",\n" : "\n");
        }
        out.append("  },\n  \"oscillators\": [");
        List<String> osc = new ArrayList<>(new OscillatorFactory().names());
        Collections.sort(osc);
        for (int i = 0; i < osc.size(); i++) out.append(i > 0 ? ", " : "").append("\"").append(esc(osc.get(i))).append("\"");
        out.append("]\n}\n");
        System.out.print(out);
    }
}
