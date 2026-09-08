# The cook goes here

Drop the rigged, animated chef as **`chef.glb`** in this folder
(`public/models/chef.glb`). The scene loads it automatically on next build;
until then it falls back to a hand-built stand-in cook.

## Getting a free one (Mixamo route — decided 2026-09-08)

1. Make a free Adobe account, go to https://www.mixamo.com
2. Pick a **normal-proportioned human** character (e.g. "Leonard", "Louise", "Ely").
3. Add these animations, one at a time, **with "In Place" ticked** where offered:
   - Idle / Breathing Idle  (the default)
   - Talking / Talking On Phone  (for when someone "asks the guide")
   - Waving
   - Standing (optional)
4. For each: **Download** → Format **glTF Binary (.glb)**, Skin **With Skin** for the
   first one and **Without Skin** for the rest.
5. Merge the clips into one `.glb` with Blender (File → Import each, join the
   actions via the NLA editor, export glTF Binary) **or** send the separate files
   and they can be merged in the build.
6. Rename the final file `chef.glb`, drop it here.

## Requirements for web

- Under ~40k triangles, one texture atlas (1–2K)
- Draco or meshopt compression on export keeps it 2–5 MB
- The chef hat / apron / neckerchief are added in the scene, the character
  underneath can be plain chef whites or street clothes

## License note

Mixamo characters and animations are free to use in projects like this.
Whatever model you pick, keep the license permissive (CC0 / CC-BY / Mixamo
terms). Do **not** use CC-NC or trademarked-character models.
