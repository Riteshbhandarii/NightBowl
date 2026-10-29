# NightBowl cook, pilot build. Re-run by the live watcher whenever this file changes.
import bpy, bmesh, importlib, math, os
from mathutils import Vector
HS = importlib.import_module('bl_ext.blender_org.mpfb.services.humanservice').HumanService
OUT = os.environ.get('COOK_OUT', os.getcwd() + '/')
RENDER = os.environ.get('COOK_RENDER') == '1'

for o in list(bpy.data.objects): bpy.data.objects.remove(o)
for m in list(bpy.data.materials):
    if m.users == 0: bpy.data.materials.remove(m)

# a sturdy middle-aged ramen master
macro = {"gender": 1.0, "age": 0.72, "muscle": 0.62, "weight": 0.68, "height": 0.62, "proportions": 0.55,
         "cupsize": 0.5, "firmness": 0.5, "race": {"african": 0.0, "asian": 1.0, "caucasian": 0.0}}
body = HS.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True,
                       feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
body.name = 'cook_body'
# MPFB shapes the body with shape keys; bake them so every measurement below is the real body
bpy.context.view_layer.objects.active = body
body.select_set(True)
if body.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
rig = HS.add_builtin_rig(body, 'game_engine', import_weights=True); rig.name = 'cook_rig'
rig.show_in_front = False
rig.hide_viewport = True

def mat(name, rgb, rough=0.7, sss=0.0, emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Subsurface Weight'].default_value = sss
    if emit: b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = 0.4
    return m
SKIN = mat('cook_skin', (0.48, 0.30, 0.20), 0.5, 0.2)
body.data.materials.clear(); body.data.materials.append(SKIN)

G = {g.name: g.index for g in body.vertex_groups}
def weight(v, names):
    return sum(g.weight for g in v.groups if body.vertex_groups[g.group].name in names)

def piece(name, keep, push, thick, material, smooth=0):
    """Copy the body, keep only the chosen vertices, inflate them into a layer that follows the skeleton."""
    me = body.data.copy(); ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob); ob.matrix_world = body.matrix_world
    for vg in body.vertex_groups: ob.vertex_groups.new(name=vg.name)
    for v in me.vertices:
        for g in v.groups: ob.vertex_groups[g.group].add([v.index], g.weight, 'REPLACE')
    sel = {v.index for v in me.vertices if keep(v)}
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in sel], context='VERTS')
    bm.normal_update()
    for v in bm.verts: v.co += v.normal * push
    bm.to_mesh(me); bm.free()
    me.materials.clear(); me.materials.append(material)
    if smooth: ob.modifiers.new('smooth', 'CORRECTIVE_SMOOTH').iterations = smooth
    if thick: ob.modifiers.new('thick', 'SOLIDIFY').thickness = thick
    arm = ob.modifiers.new('rig', 'ARMATURE'); arm.object = rig
    ob.parent = rig
    for p in me.polygons: p.use_smooth = True
    return ob

body_only = lambda v: weight(v, {'body'}) > 0.5
# samue jacket: torso and upper arms, sleeves rolled to just above the elbow
JACKET = mat('cook_samue', (0.70, 0.68, 0.63), 0.9)  # off-white: reads in the dark stall
TORSO = {'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r'}
piece('cook_jacket', lambda v: body_only(v) and weight(v, TORSO) > 0.55, 0.016, 0.008, JACKET, smooth=4)
# hide the skin the clothes cover: no poke-through, and fewer triangles for the web
covered = body.vertex_groups.new(name='covered_by_clothes')
covered.add([v.index for v in body.data.vertices if body_only(v) and (weight(v, TORSO) > 0.8 or weight(v, {'helper-tights'}) > 0.5
             or weight(v, {'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r'}) > 0.6)], 1.0, 'REPLACE')
hide = body.modifiers.new('hide_covered', 'MASK'); hide.vertex_group = 'covered_by_clothes'; hide.invert_vertex_group = True
# trousers from the tights helper, which is already fitted to the legs
PANTS = mat('cook_trousers', (0.02, 0.02, 0.022), 0.9)
piece('cook_trousers', lambda v: weight(v, {'helper-tights'}) > 0.5, 0.004, 0.005, PANTS, smooth=2)
# hair from the hair helper: short and dark
HAIR = mat('cook_hair', (0.012, 0.010, 0.009), 0.55)
piece('cook_hair', lambda v: body_only(v) and weight(v, {'scalp'}) > 0.4, 0.005, 0.01, HAIR, smooth=3)
# eyes from the eye helpers
EYE = mat('cook_eye', (0.75, 0.72, 0.68), 0.15)
eyes = piece('cook_eyes', lambda v: weight(v, {'helper-l-eye', 'helper-r-eye'}) > 0.5, 0.0, 0.0, EYE)

# where things are, measured on the posed body
W = body.matrix_world
def centre(names):
    pts = [W @ v.co for v in body.data.vertices if weight(v, names) > 0.5]
    return sum(pts, Vector()) / len(pts), pts
# the head: everything above the chin line, measured on the skin itself
skin_pts = [W @ v.co for v in body.data.vertices if body_only(v)]
top = max(p.z for p in skin_pts)
head_pts = [p for p in skin_pts if p.z > top - 0.23]
head_c = sum(head_pts, Vector()) / len(head_pts)

# irises: a dark disc on the front of each eyeball
IRIS = mat('cook_iris', (0.03, 0.018, 0.012), 0.2)
for side in ('helper-l-eye', 'helper-r-eye'):
    c, pts = centre({side})
    r = max((p - c).length for p in pts)
    front = min(p.y for p in pts)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=r * 0.48, depth=0.002, location=(c.x, front + 0.0006, c.z), rotation=(math.radians(90), 0, 0))
    d = bpy.context.object; d.name = 'cook_iris_' + side[-5]; d.data.materials.append(IRIS)
    d.parent = rig; d.matrix_parent_inverse = rig.matrix_world.inverted()

# tenugui headband: a fitted band on the forehead, a little lower at the back
band_z = top - 0.072
ring = [p for p in head_pts if abs(p.z - band_z) < 0.006]
cxy = Vector((sum(p.x for p in ring) / len(ring), sum(p.y for p in ring) / len(ring), band_z))
dists = sorted(math.hypot(p.x - cxy.x, p.y - cxy.y) for p in ring)
rad = dists[int(len(dists) * 0.7)] + 0.004
bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=rad, depth=0.034, end_fill_type='NOTHING', location=cxy)
band = bpy.context.object; band.name = 'cook_headband'
band.rotation_euler = (math.radians(-9), 0, 0)  # tilt: high at the brow, lower at the back
band.modifiers.new('thick', 'SOLIDIFY').thickness = 0.006
TENUGUI = mat('cook_tenugui', (0.80, 0.78, 0.72), 0.85)
band.data.materials.append(TENUGUI)
for p in band.data.polygons: p.use_smooth = True
for s_ in (-1, 1):  # knot tails at the back
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cxy.x + s_ * 0.022, cxy.y + rad + 0.01, band_z - 0.045))
    t = bpy.context.object; t.scale = (0.026, 0.004, 0.07); t.rotation_euler = (0.25, 0, s_ * 0.35)
    t.data.materials.append(TENUGUI); t.name = f'cook_knot_{"lr"[s_ > 0]}'
    t.parent = rig; t.matrix_parent_inverse = rig.matrix_world.inverted()
band.parent = rig; band.matrix_parent_inverse = rig.matrix_world.inverted()

# maekake apron: chest to knee, wrapped a little around the hips
torso = [W @ v.co for v in body.data.vertices if body_only(v) and weight(v, {'pelvis', 'spine_01'}) > 0.5]
front_y = min(p.y for p in torso) - 0.018
bpy.ops.mesh.primitive_grid_add(x_subdivisions=14, y_subdivisions=18, size=1, location=(head_c.x, front_y, top * 0.43))
ap = bpy.context.object; ap.name = 'cook_apron'
ap.scale = (0.40, 0.56, 1); ap.rotation_euler = (math.radians(90), 0, 0)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bend = ap.modifiers.new('wrap', 'SIMPLE_DEFORM'); bend.deform_method = 'BEND'; bend.angle = math.radians(55); bend.deform_axis = 'Z'
ap.modifiers.new('thick', 'SOLIDIFY').thickness = 0.005
APRON = mat('cook_maekake', (0.11, 0.025, 0.018), 0.9)
ap.data.materials.append(APRON)
for p in ap.data.polygons: p.use_smooth = True
ap.parent = rig; ap.matrix_parent_inverse = rig.matrix_world.inverted()

# relaxed pose: arms down, a slight bend at the elbow, as if waiting at the pot
rig.hide_viewport = False
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
from mathutils import Matrix
def swing(bone, deg, axis):
    # rotate a bone about a world axis through its own joint
    pb = rig.pose.bones[bone]
    h = pb.head.copy()
    pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()
swing('upperarm_l', 48, 'Y'); swing('upperarm_r', -48, 'Y')   # arms down by the sides
swing('lowerarm_l', -16, 'X'); swing('lowerarm_r', -16, 'X')   # a little bend forward at the elbow
bpy.ops.object.mode_set(mode='OBJECT')
rig.hide_viewport = True

# light it like the stall: warm key, cool rim, near-black around
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x, sc.render.resolution_y = 1000, 1250
w = bpy.data.worlds.get('cook_world') or bpy.data.worlds.new('cook_world'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.004, 0.005, 1)
aim = Vector((head_c.x, head_c.y, top * 0.72))
def light(name, loc, energy, rgb, size=1.0):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.color = rgb; d.size = size
    o = bpy.data.objects.new(name, d); o.location = loc; sc.collection.objects.link(o)
    o.rotation_euler = (aim - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
light('key_warm', (1.1, -1.5, 2.1), 220, (1.0, 0.72, 0.45), 1.0)
light('rim_cool', (-1.3, 1.3, 2.0), 260, (0.5, 0.62, 1.0), 0.7)
light('fill', (-1.2, -2.0, 1.2), 25, (1.0, 0.88, 0.8), 2.5)
cam = bpy.data.objects.new('cook_cam', bpy.data.cameras.new('cook_cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 70
cam.location = (0.9, -3.6, top * 0.62)
cam.rotation_euler = (Vector((head_c.x, head_c.y, top * 0.55)) - cam.location).to_track_quat('-Z', 'Y').to_euler()

if RENDER:
    for name, loc, look in (('front', (0.9, -3.6, top * 0.62), top * 0.55), ('closeup', (0.32, -1.2, top * 0.93), top * 0.9)):
        cam.location = loc
        cam.rotation_euler = (Vector((head_c.x, head_c.y, look)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = OUT + f'cook_{name}.png'
        bpy.ops.render.render(write_still=True)
    dg = bpy.context.evaluated_depsgraph_get()
    tris = sum(sum(len(p.vertices) - 2 for p in o.evaluated_get(dg).to_mesh().polygons) for o in sc.objects if o.type == 'MESH')
    print('TOTAL_TRIS', tris, 'HEIGHT', round(top, 3))

if os.environ.get('COOK_EXPORT') == '1':
    # lighter for the web: collapse the dense skin and cloth, keep the rig and the hands
    for o in [o for o in sc.objects if o.type == 'MESH' and o.name in ('cook_body', 'cook_jacket', 'cook_trousers', 'cook_hair')]:
        d = o.modifiers.new('web', 'DECIMATE'); d.ratio = float(os.environ.get('COOK_RATIO', '0.35'))
        while o.modifiers[0] != d: bpy.ops.object.modifier_move_up({'object': o}, modifier=d.name) if False else o.modifiers.move(o.modifiers.find(d.name), 0)
    # make the relaxed pose the bind pose, so any viewer shows it without animation
    rig.hide_viewport = False
    for o in [o for o in sc.objects if o.type == 'MESH' and o.name.startswith('cook_')]:
        arm = next((m for m in o.modifiers if m.type == 'ARMATURE'), None)
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):  # bake everything (decimate, mask, solidify, pose) into the mesh
            try: bpy.ops.object.modifier_apply(modifier=m.name)
            except RuntimeError: o.modifiers.remove(m)
        o.data.update()
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.armature_apply(selected=False); bpy.ops.object.mode_set(mode='OBJECT')
    for o in [o for o in sc.objects if o.type == 'MESH' and o.name.startswith('cook_')]:
        if o.vertex_groups:
            a = o.modifiers.new('rig', 'ARMATURE'); a.object = rig
        if o.parent != rig:
            mw = o.matrix_world.copy(); o.parent = rig; o.matrix_world = mw
    for o in sc.objects: o.select_set(o.type in ('MESH', 'ARMATURE') and o.name.startswith('cook_'))
    bpy.ops.export_scene.gltf(filepath=os.environ['COOK_GLB'], export_format='GLB', use_selection=True,
                              export_apply=True, export_rest_position_armature=False, export_animations=False,
                              export_yup=True)
    dg = bpy.context.evaluated_depsgraph_get()
    tris = sum(sum(len(p.vertices) - 2 for p in o.evaluated_get(dg).to_mesh().polygons) for o in sc.objects if o.type == 'MESH' and o.select_get())
    print('EXPORT_TRIS', tris, os.path.getsize(os.environ['COOK_GLB']))
