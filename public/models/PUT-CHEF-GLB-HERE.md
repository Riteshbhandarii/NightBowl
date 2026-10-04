# Original Blender character handoff

Issue #79 supersedes the old Mixamo plan: build an original cook, then at least
ten distinct NPC looks. One good cook is the first integration checkpoint;
variants come after the rig works in the scene.

## What to hand over first

- A backed-up, editable `.blend` source and a matching test GLB. Keep the source
  outside `public/` so it is not shipped to every visitor.
- Front/side views and a short note identifying the mesh, armature, materials,
  proportions, facing and any borrowed assets/license obligations.
- Simple low-poly geometry with consistent object/bone names, clean weights
  where rigged and separate clothing/accessories where useful. An unfinished
  rig can be inspected and repaired; do not hide it by exporting only a mesh.
- Enough shoulder, elbow, wrist, hip, knee and ankle control for the cook's
  stirring, carrying, serving, wiping and walking. Specific bone names and
  action bindings will be agreed when the actual rig is inspected, not guessed
  before it exists.

In the exported glTF, the current loader assumes +Y is up, the character faces
+Z and feet are at ground height y=0. It scales the model to about 1.7 scene
units tall; verify the exported result rather than relying on Blender's viewport
axes. Include the cook's actual clothing in the asset; the GLB loader does not
automatically add the procedural cook's hat/apron.

Useful test poses are idle, stirring, both-hand bowl carry, serving and wiping.
Keep tools separate so ladle/cloth/bowl contact can follow live scene objects.
NPC integration additionally needs sitting, eating, drinking, standing and
forward-facing walking, with bags attached to the character.

## The loader is not the complete integration

`public/models/chef.glb` is a **legacy display/idle path**. When that file loads,
`loadCook()` displays it and plays one idle/breathing clip (or the first clip).
It does not create `guideRig`, attach tools, initialize cook AI or retarget the
service/visitor/turnover actions. This can bypass the tested procedural cook.

Do not put an unintegrated model at that public path on main. Inspect and test it
in an isolated branch first. The rig adapter and action/contact wiring remain
engineering work under #79; this guide does not claim they are implemented.
Do not enable Draco/meshopt compression yet: the existing GLTFLoader has no
corresponding decoder configured. Use an ordinary GLB for the first handoff.

## Budgets apply to the whole scene

There is no 40k-triangle allowance for a single character. Existing gates cap
startup draw calls at 250 and the reduced-motion phone-landscape view at 50,000
triangles. The current placeholder scene is already close to those limits.
Replacement assets must fit the complete rendered scene; animated peaks are
measured separately. Real phone FPS is still unverified (#34).

Use few materials, shared geometry and restrained textures where practical.
The initial first-party payload remains capped at 750 KiB raw / 250 KiB gzip;
model/texture requests must also be inspected in the browser network and
throttled-load tests, not treated as free because they are separate requests.
No arbitrary transfer allowance or compressed-size promise replaces measurement.

## Finish condition

The original cook performs all four work actions in NightBowl, with correct
hand/tool/bowl contact and no furniture/body clipping, and existing build,
CMS, browser, visitor, NPC, IK and performance gates remain green. Inspect
rendered screenshots, not only numeric tests. Then make NPC variants and run
the same seated/walking checks before replacing the rest of the cast.

Keep provenance for any borrowed assets; use only permissions compatible with
publishing this portfolio. No trademarked characters or non-commercial-only
assets. Final personal copy remains Ritesh's separate task after the cast is stable.
