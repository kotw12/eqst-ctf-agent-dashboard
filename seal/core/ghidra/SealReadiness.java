import com.google.gson.Gson;
import ghidra.app.script.GhidraScript;
import ghidra.framework.Application;
import java.util.Map;

public class SealReadiness extends GhidraScript {
    @Override
    public void run() {
        println("SEAL_GHIDRA_PROBE=" + new Gson().toJson(Map.of(
            "version", Application.getApplicationVersion(),
            "language", currentProgram.getLanguageID().toString(),
            "bytes", currentProgram.getMemory().getSize()
        )));
    }
}
