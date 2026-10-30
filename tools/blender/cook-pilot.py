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

# relaxed pose first: arms down by the sides, a slight bend at the elbow. It becomes the rest
# pose, so every garment below is shaped around a man standing at his pot, not in a T-pose.
from mathutils import Matrix
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
def swing(bone, deg, axis):
    # rotate a bone about a world axis through its own joint
    pb = rig.pose.bones[bone]
    h = pb.head.copy()
    pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()
swing('upperarm_l', 48, 'Y'); swing('upperarm_r', -48, 'Y')
swing('lowerarm_l', -16, 'X'); swing('lowerarm_r', -16, 'X')
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.objects.active = body
for m in [m for m in body.modifiers if m.type == 'ARMATURE']:
    bpy.ops.object.modifier_apply(modifier=m.name)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.armature_apply(selected=False); bpy.ops.object.mode_set(mode='OBJECT')
body.modifiers.new('rig', 'ARMATURE').object = rig
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

def piece(name, keep, push, thick, material, smooth=0, relax=0):
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
    if relax:  # cloth hangs over the body; it does not follow every bump of it
        inner = [v for v in bm.verts if not v.is_boundary]
        for _ in range(relax):
            bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
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
# Chef's coat, built as cloth over the body rather than copied from it. From the references:
# a loose white double-breasted coat with a stand-up mandarin collar, two rows of cloth knot
# buttons, sleeves rolled to the elbow, hem at the hip.
from mathutils import kdtree, Matrix
from mathutils.bvhtree import BVHTree
JACKET = mat('cook_coat', (0.80, 0.79, 0.76), 0.92)
KNOT = mat('cook_coat_knot', (0.62, 0.61, 0.58), 0.9)
TORSO = {'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r'}
TRUNK = {'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'neck_01'}
BONE_NAMES = {b.name for b in rig.data.bones}
def owner(v):
    best, bw = None, 0.0
    for g in v.groups:
        n = body.vertex_groups[g.group].name
        if n in BONE_NAMES and g.weight > bw: best, bw = n, g.weight
    return best
W = body.matrix_world
def bone_head(n): return rig.matrix_world @ rig.data.bones[n].head_local
def bone_tail(n): return rig.matrix_world @ rig.data.bones[n].tail_local
NECK_CUT = bone_head('neck_01').z + 0.03
skin = [(v.index, W @ v.co, owner(v)) for v in body.data.vertices if body_only(v)]  # indices: vertex refs go stale

def hull2d(pts):
    pts = sorted(set((round(x, 4), round(y, 4)) for x, y in pts))
    if len(pts) < 3: return pts
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]
def ray_hull(hull, c, ang):
    # distance from c to the hull edge along angle ang
    dx, dy = math.cos(ang), math.sin(ang); best = 0.0
    for i in range(len(hull)):
        ax, ay = hull[i][0] - c[0], hull[i][1] - c[1]
        bx, by = hull[(i + 1) % len(hull)][0] - c[0], hull[(i + 1) % len(hull)][1] - c[1]
        ex, ey = bx - ax, by - ay
        den = dx * ey - dy * ex
        if abs(den) < 1e-9: continue
        t = (ax * ey - ay * ex) / den; u = (ax * dy - ay * dx) / den
        if t > 0 and -1e-6 <= u <= 1 + 1e-6: best = max(best, t)
    return best

def weigh(ob, cand):
    """Skin a garment: every vertex copies the bone weights of the nearest body vertex in cand."""
    kd = kdtree.KDTree(len(cand))
    for i, (v, p, o) in enumerate(cand): kd.insert(p, i)
    kd.balance()
    for g in body.vertex_groups:
        if g.name in BONE_NAMES and g.name not in ob.vertex_groups: ob.vertex_groups.new(name=g.name)
    for mv in ob.data.vertices:
        _, i, _ = kd.find(ob.matrix_world @ mv.co)
        for g in body.data.vertices[cand[i][0]].groups:
            n = body.vertex_groups[g.group].name
            if n in BONE_NAMES: ob.vertex_groups[n].add([mv.index], g.weight, 'REPLACE')
    a = ob.modifiers.new('rig', 'ARMATURE'); a.object = rig
    ob.parent = rig; ob.matrix_parent_inverse = rig.matrix_world.inverted()

def loft(name, rings, material, close_top=False):
    bm = bmesh.new(); vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for a, b in zip(vs, vs[1:]):
        for k in range(n): bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    me.materials.append(material)
    for p in me.polygons: p.use_smooth = True
    return ob

# --- body of the coat: one convex ring per height, so it bridges the chest and falls straight
NA = 64
hem_z = bone_head('pelvis').z - 0.13
trunk = [(v, p, o) for v, p, o in skin if o in TRUNK]
# the top of each upper arm sits under the coat's shoulder, so the shoulder line is continuous
shoulder = []
for side in ('l', 'r'):
    a0, a1 = bone_head('upperarm_' + side), bone_head('lowerarm_' + side)
    ax = a1 - a0
    shoulder += [(v, p, o) for v, p, o in skin if o == 'upperarm_' + side and (p - a0).dot(ax) / ax.length_squared < 0.3]
trunk_hull = trunk + shoulder
cx0 = sum(p.x for _, p, _ in trunk) / len(trunk)
zs = [hem_z + i * 0.02 for i in range(int((NECK_CUT - hem_z) / 0.02) + 1)]
radii, centres = [], []
for z in zs:
    sl = [(p.x, p.y) for _, p, o in trunk_hull if abs(p.z - z) < 0.013]
    if len(sl) < 8: sl = [(p.x, p.y) for _, p, o in skin if abs(p.z - z) < 0.013 and o in TRUNK | {'thigh_l', 'thigh_r'}]
    h = hull2d(sl); c = (cx0, sum(y for _, y in h) / len(h))
    centres.append(c); radii.append([ray_hull(h, c, 2 * math.pi * k / NA) for k in range(NA)])
# cloth falls from the widest point: going down, a ring never pulls in faster than a hanging coat
for i in range(len(zs) - 2, -1, -1):
    if zs[i] < bone_head('spine_03').z:
        radii[i] = [max(r, radii[i + 1][k] * 0.985) for k, r in enumerate(radii[i])]
for _ in range(4):  # smooth between heights so the fabric has no ripples
    radii = [radii[0]] + [[(a + 2 * b + c) / 4 for a, b, c in zip(radii[i - 1], radii[i], radii[i + 1])] for i in range(1, len(radii) - 1)] + [radii[-1]]
def ease(z):  # ease: snug at the collar, roomy at the chest, a little flare at the hem
    t = (z - hem_z) / (NECK_CUT - hem_z)
    return 0.012 if t > 0.97 else 0.030 - 0.010 * max(0.0, (t - 0.75) / 0.22) + 0.012 * max(0.0, 0.18 - t) / 0.18
rings = [[Vector((c[0] + (r + ease(z)) * math.cos(2 * math.pi * k / NA), c[1] + (r + ease(z)) * math.sin(2 * math.pi * k / NA), z))
          for k, r in enumerate(rr)] for z, c, rr in zip(zs, centres, radii)]
coat = loft('cook_jacket', rings, JACKET)
coat.modifiers.new('thick', 'SOLIDIFY').thickness = 0.007
coat.modifiers.new('soft', 'SUBSURF').levels = 1
weigh(coat, trunk_hull)

# --- sleeves: loose tubes along the upper arm, rolled at the elbow
for side in ('l', 'r'):
    a0, a1 = bone_head('upperarm_' + side), bone_head('lowerarm_' + side)
    axis = (a1 - a0).normalized()
    arm_pts = [(v, p, o) for v, p, o in skin if o in ('upperarm_' + side, 'lowerarm_' + side, 'clavicle_' + side)]
    u = axis.orthogonal().normalized(); w = axis.cross(u)
    rings_s, NS = [], 32
    ts = [0.18 + i * 0.075 for i in range(13)]
    ts = [t for t in ts if t <= 1.08]
    for t in ts:
        c = a0.lerp(a1, t)
        sl = [((p - c).dot(u), (p - c).dot(w)) for _, p, _ in arm_pts if abs((p - c).dot(axis)) < 0.015]
        h = hull2d(sl) if len(sl) >= 6 else None
        rr = [ray_hull(h, (0, 0), 2 * math.pi * k / NS) if h else 0.06 for k in range(NS)]
        mean = sum(rr) / NS; rr = [0.5 * r + 0.5 * mean + (0.014 if t < 0.2 else 0.019) for r in rr]  # round and loose
        rings_s.append([c + u * (r * math.cos(2 * math.pi * k / NS)) + w * (r * math.sin(2 * math.pi * k / NS)) for k, r in enumerate(rr)])
    sl_ob = loft(f'cook_sleeve_{side}', rings_s, JACKET)
    sl_ob.modifiers.new('thick', 'SOLIDIFY').thickness = 0.006
    weigh(sl_ob, arm_pts)
    # the rolled cuff
    end = rings_s[-1]; ce = sum(end, Vector()) / len(end); rc = sum((p - ce).length for p in end) / len(end)
    bpy.ops.mesh.primitive_torus_add(major_radius=rc + 0.004, minor_radius=0.013, major_segments=32, minor_segments=8, location=ce)
    cuff = bpy.context.object; cuff.name = f'cook_cuff_{side}'
    cuff.rotation_euler = axis.to_track_quat('Z', 'Y').to_euler()
    cuff.data.materials.append(JACKET)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    for p in cuff.data.polygons: p.use_smooth = True
    weigh(cuff, arm_pts)

# --- mandarin collar: a stand-up band, open a finger's width at the front
top_ring = rings[-1]; ct = sum(top_ring, Vector()) / len(top_ring)
col = []
for k in range(NA):
    ang = 2 * math.pi * k / NA
    if abs(((ang - (-math.pi / 2)) + math.pi) % (2 * math.pi) - math.pi) < math.radians(11): continue
    col.append(k)
bm = bmesh.new()
lo = {k: bm.verts.new(top_ring[k] + (top_ring[k] - ct) * 0.04) for k in col}
hi = {k: bm.verts.new(Vector((ct.x + (top_ring[k].x - ct.x) * 0.93, ct.y + (top_ring[k].y - ct.y) * 0.93, top_ring[k].z + 0.042))) for k in col}
for k in col:
    k2 = (k + 1) % NA
    if k2 in lo: bm.faces.new((lo[k], lo[k2], hi[k2], hi[k]))
me = bpy.data.meshes.new('cook_collar'); bm.to_mesh(me); bm.free()
collar = bpy.data.objects.new('cook_collar', me); bpy.context.collection.objects.link(collar)
me.materials.append(JACKET)
for p in me.polygons: p.use_smooth = True
collar.modifiers.new('thick', 'SOLIDIFY').thickness = 0.008
weigh(collar, [s for s in trunk if s[2] in ('neck_01', 'spine_03', 'clavicle_l', 'clavicle_r')])

# --- the double-breasted front: overlap edge and two rows of knot buttons, on the coat surface
dg = bpy.context.evaluated_depsgraph_get()
bvh = BVHTree.FromObject(coat, dg)
def on_front(x, z):
    hit = bvh.ray_cast(Vector((x, -2.0, z)), Vector((0, 1, 0)))
    return hit[0], hit[1]
edge_x = cx0 - 0.085  # the wearer's right panel laps over to here
strip = bpy.data.meshes.new('cook_placket'); bm = bmesh.new(); prev = None
for z in [hem_z + 0.02 + i * 0.02 for i in range(int((NECK_CUT - hem_z - 0.03) / 0.02))]:
    loc, nrm = on_front(edge_x, z)
    if loc is None: continue
    a = bm.verts.new(loc + nrm * 0.004 + Vector((-0.004, 0, 0))); b = bm.verts.new(loc + nrm * 0.004 + Vector((0.004, 0, 0)))
    if prev: bm.faces.new((prev[0], prev[1], b, a))
    prev = (a, b)
bm.to_mesh(strip); bm.free()
plk = bpy.data.objects.new('cook_placket', strip); bpy.context.collection.objects.link(plk); strip.materials.append(KNOT)
plk.modifiers.new('thick', 'SOLIDIFY').thickness = 0.003
weigh(plk, trunk)
bz0, bz1 = bone_head('spine_01').z + 0.02, NECK_CUT - 0.07
for row_x in (cx0 - 0.065, cx0 + 0.065):
    for i in range(5):
        loc, nrm = on_front(row_x, bz0 + (bz1 - bz0) * i / 4)
        if loc is None: continue
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.0085, location=loc + nrm * 0.006)
        bt = bpy.context.object; bt.name = f'cook_button_{row_x > cx0}_{i}'; bt.scale = (1, 0.55, 1)
        bt.data.materials.append(KNOT)
        weigh(bt, trunk)

# hide the skin the clothes cover: no poke-through, and fewer triangles for the web
covered = body.vertex_groups.new(name='covered_by_clothes')
covered.add([v.index for v in body.data.vertices if body_only(v) and (W @ v.co).z < NECK_CUT - 0.01 and owner(v) in TORSO | {'neck_01'}], 1.0, 'REPLACE')
hide = body.modifiers.new('hide_covered', 'MASK'); hide.vertex_group = 'covered_by_clothes'; hide.invert_vertex_group = True
# trousers from the tights helper, which is already fitted to the legs
PANTS = mat('cook_trousers', (0.02, 0.02, 0.022), 0.9)
LEG_BONES = {'pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'}
piece('cook_trousers', lambda v: weight(v, {'helper-tights'}) > 0.5 and weight(v, LEG_BONES) > 0.5, 0.004, 0.005, PANTS, smooth=2)
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

# toque blanche, from the references: a tall white pleated hat on a fitted band, with a soft
# crown that puffs out over the pleats. It sits level on the brow.
band_z = top - 0.085
ring = [p for p in head_pts if abs(p.z - band_z) < 0.006]
cxy = Vector((sum(p.x for p in ring) / len(ring), sum(p.y for p in ring) / len(ring), band_z))
head_hull = hull2d([(p.x, p.y) for p in head_pts if abs(p.z - band_z) < 0.03])
rad = 0.0  # per-angle radius below; the fitted band follows the skull, the pleats round it out
band_r = [ray_hull(head_hull, (cxy.x, cxy.y), 2 * math.pi * k / 96) + 0.024 for k in range(96)]
mean_r = sum(band_r) / len(band_r)
TOQUE = mat('cook_toque', (0.86, 0.85, 0.82), 0.9)
NP = 96  # 48 pleats
def pleat(k, amp): return amp * (1 if k % 2 else -1)
profile = [  # (height above the band's lower edge, radius growth, pleat depth)
    (0.000, 0.000, 0.0), (0.045, 0.000, 0.0),        # the band
    (0.045, 0.004, 0.004), (0.09, 0.012, 0.006), (0.15, 0.024, 0.006),
    (0.18, 0.040, 0.004), (0.198, 0.042, 0.002),     # the puff overhangs the pleats
    (0.212, 0.032, 0.0), (0.222, 0.016, 0.0),        # soft dome
]
z0 = band_z - 0.02
def hat_r(k, h, g, a):
    # the band hugs the head; higher up the hat rounds out to a circle
    blend = min(1.0, h / 0.12)
    return band_r[k] * (1 - blend) + mean_r * blend + g + pleat(k, a)
rings_t = [[Vector((cxy.x + hat_r(k, h, g, a) * math.cos(2 * math.pi * k / NP),
                    cxy.y + hat_r(k, h, g, a) * math.sin(2 * math.pi * k / NP), z0 + h)) for k in range(NP)]
           for h, g, a in profile]
toque = loft('cook_toque', rings_t, TOQUE)
bm = bmesh.new(); bm.from_mesh(toque.data)
top_edge = [v for v in bm.verts if abs(v.co.z - (z0 + profile[-1][0])) < 1e-5]
cap = bm.verts.new((cxy.x, cxy.y, z0 + 0.226))
top_sorted = sorted(top_edge, key=lambda v: math.atan2(v.co.y - cxy.y, v.co.x - cxy.x))
for a, b in zip(top_sorted, top_sorted[1:] + top_sorted[:1]): bm.faces.new((a, b, cap))
bm.to_mesh(toque.data); bm.free()
toque.modifiers.new('thick', 'SOLIDIFY').thickness = 0.005
toque.modifiers.new('soft', 'SUBSURF').levels = 1
toque.parent = rig; toque.matrix_parent_inverse = rig.matrix_world.inverted()
# the hair under the hat is never seen; drop it so none of it pokes through the band
hair = bpy.data.objects['cook_hair']
bm = bmesh.new(); bm.from_mesh(hair.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if (hair.matrix_world @ v.co).z > z0 + 0.01], context='VERTS')
bm.to_mesh(hair.data); bm.free()

# waist apron, worn over the coat: wraps the front and sides from the waist to the knee
APRON = mat('cook_maekake', (0.11, 0.025, 0.018), 0.9)
waist_z = bone_head('pelvis').z + 0.08
def coat_r(z, k):
    # the coat's radius at height z (clamped to the hem ring below it)
    i_ = max(0, min(len(zs) - 1, int(round((z - hem_z) / 0.02))))
    return centres[i_], radii[i_][k] + ease(zs[i_])
knee_z = bone_head('calf_l').z + 0.02
ks = [k for k in range(NA) if math.cos(2 * math.pi * k / NA - (-math.pi / 2)) > -0.25]  # front and sides
ks.sort(key=lambda k: ((2 * math.pi * k / NA - math.pi / 2) % (2 * math.pi)))  # the open edges meet at the back
rows = []
for zi in [waist_z - i * 0.03 for i in range(int((waist_z - knee_z) / 0.03) + 1)]:
    row = []
    for k in ks:
        c, r = coat_r(max(zi, hem_z), k)
        r += 0.012 + 0.03 * max(0.0, (hem_z - zi)) / 0.4  # sits on the coat, hangs a little looser below the hem
        a = 2 * math.pi * k / NA
        row.append(Vector((c[0] + r * math.cos(a), c[1] + r * math.sin(a), zi)))
    rows.append(row)
bm = bmesh.new(); vv = [[bm.verts.new(p) for p in r] for r in rows]
for a_, b_ in zip(vv, vv[1:]):
    for k in range(len(ks) - 1): bm.faces.new((a_[k], a_[k + 1], b_[k + 1], b_[k]))
me = bpy.data.meshes.new('cook_apron'); bm.to_mesh(me); bm.free()
ap = bpy.data.objects.new('cook_apron', me); bpy.context.collection.objects.link(ap); me.materials.append(APRON)
for p in me.polygons: p.use_smooth = True
ap.modifiers.new('thick', 'SOLIDIFY').thickness = 0.005
weigh(ap, [t for t in trunk if t[2] == 'pelvis'])
# waist tie
ring_w = [coat_r(waist_z, k) for k in range(NA)]
wr = [Vector((c[0] + (r + 0.016) * math.cos(2 * math.pi * k / NA), c[1] + (r + 0.016) * math.sin(2 * math.pi * k / NA), waist_z + dz))
      for dz in (0.0, 0.03) for k, (c, r) in enumerate(ring_w)]
tie = loft('cook_apron_tie', [wr[:NA], wr[NA:]], APRON)
tie.modifiers.new('thick', 'SOLIDIFY').thickness = 0.004
weigh(tie, [t for t in trunk if t[2] in ('pelvis', 'spine_01')])



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
    for name, loc, look in (('front', (0.9, -3.6, top * 0.62), top * 0.55), ('closeup', (0.32, -1.2, top * 0.93), top * 0.9), ('back', (-0.3, 1.3, top * 0.93), top * 0.86)):
        cam.location = loc
        cam.rotation_euler = (Vector((head_c.x, head_c.y, look)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = OUT + f'cook_{name}.png'
        bpy.ops.render.render(write_still=True)
    dg = bpy.context.evaluated_depsgraph_get()
    tris = sum(sum(len(p.vertices) - 2 for p in o.evaluated_get(dg).to_mesh().polygons) for o in sc.objects if o.type == 'MESH')
    print('TOTAL_TRIS', tris, 'HEIGHT', round(top, 3))

if os.environ.get('COOK_EXPORT') == '1':
    # lighter for the web: collapse the dense skin and cloth, keep the rig and the hands
    for o in [o for o in sc.objects if o.type == 'MESH' and o.name.startswith('cook_')]:
        for m in [m for m in o.modifiers if m.type == 'SUBSURF']: o.modifiers.remove(m)  # smooth shading is enough on the web
    for o in [o for o in sc.objects if o.type == 'MESH' and o.name.startswith(('cook_body', 'cook_jacket', 'cook_trousers', 'cook_hair', 'cook_sleeve', 'cook_apron', 'cook_toque'))]:
        d = o.modifiers.new('web', 'DECIMATE'); d.ratio = float(os.environ.get('COOK_RATIO', '0.35')) if o.name in ('cook_body', 'cook_trousers', 'cook_hair') else 0.6
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
    def pin(obj, bone):
        mw = obj.matrix_world.copy()
        obj.parent = rig; obj.parent_type = 'BONE'; obj.parent_bone = bone
        obj.matrix_world = mw
    for o in list(sc.objects):
        if o.name.startswith(('cook_iris', 'cook_headband', 'cook_knot', 'cook_toque')): pin(o, 'head')
    # ladle in the right hand
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.008, depth=0.32, location=(0, 0, -0.15))
    handle = bpy.context.object; handle.name = 'cook_ladle'
    bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=8, radius=0.045, location=(0, 0, -0.33))
    cup = bpy.context.object; cup.scale.z = 0.55
    LADLE = mat('cook_ladle', (0.55, 0.55, 0.56), 0.35); LADLE.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.8
    handle.data.materials.append(LADLE); cup.data.materials.append(LADLE)
    bpy.ops.object.select_all(action='DESELECT'); handle.select_set(True); cup.select_set(True)
    bpy.context.view_layer.objects.active = handle; bpy.ops.object.join()
    hand = rig.pose.bones['hand_r']
    handle.parent = rig; handle.parent_type = 'BONE'; handle.parent_bone = 'hand_r'
    handle.matrix_world = rig.matrix_world @ Matrix.Translation(hand.tail + (hand.tail - hand.head).normalized() * 0.02) @ Matrix.Rotation(math.radians(-25), 4, 'X')

    # stir with IK: the right hand follows a target circling over the pot, the left rests on the counter.
    # The pot sits 0.58 m to the cook's right and half a metre in front of him in the stall.
    bpy.context.view_layer.objects.active = rig
    sc.render.fps = 24
    FR = 48
    def empty(name, loc):
        e = bpy.data.objects.new(name, None); sc.collection.objects.link(e); e.location = loc; return e
    # measured from the stall (pot scaled 0.52): broth at 1.31 m, 0.58 m to his right, 0.5 m ahead, 0.22 m radius.
    # The ladle cup hangs 0.26 m below the fist, so the fist stirs at 1.54 m.
    # the cook stands 0.2 m nearer the pot in the stall (see dressPilotCook), so this is within an easy reach
    POT = Vector((-0.34, -0.38, 1.38))  # chest height: the elbow bends and the ladle reaches down into the broth
    tr = empty('ik_hand_r', POT)
    tl = empty('ik_hand_l', (0.16, -0.40, 1.12))
    pr = empty('ik_pole_r', (-0.75, 0.25, 1.25)); pl = empty('ik_pole_l', (0.7, 0.25, 1.2))
    bpy.ops.object.mode_set(mode='POSE')
    # turn the shoulders a little toward the pot
    sp = rig.pose.bones['spine_02']; sp.rotation_mode = 'XYZ'
    for f in (0, FR):
        sp.rotation_euler = (0, 0, 0); bpy.context.view_layer.update()
    swing('spine_01', -7, 'X')                                   # lean in over the pot
    swing('spine_02', -20, 'Z'); swing('spine_03', -8, 'Z')      # shoulders toward it
    # fingers closed round the ladle handle
    for fname in ('index', 'middle', 'ring', 'pinky'):
        for k in ('01', '02', '03'):
            pb = rig.pose.bones.get(f'{fname}_{k}_r')
            if pb: pb.rotation_mode = 'XYZ'; pb.rotation_euler = (math.radians(58), 0, 0)  # local X curls toward the palm
    for k in ('02', '03'):
        pb = rig.pose.bones.get(f'thumb_{k}_r')
        if pb: pb.rotation_mode = 'XYZ'; pb.rotation_euler = (math.radians(28), 0, 0)
    for side, tgt, pole in (('r', tr, pr), ('l', tl, pl)):
        c = rig.pose.bones['lowerarm_' + side].constraints.new('IK')
        c.target = tgt; c.chain_count = 2; c.pole_target = pole; c.pole_angle = math.radians(-90 if side == 'r' else 90)
    bpy.ops.object.mode_set(mode='OBJECT')
    for f in range(FR + 1):
        t = 2 * math.pi * f / FR
        tr.location = POT + Vector((0.08 * math.cos(t), 0.08 * math.sin(t), 0.01 * math.sin(2 * t)))
        tr.keyframe_insert('location', frame=f)
    # bake the solved pose into plain keys the browser can play, then drop the helpers
    rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=0, frame_end=FR, only_selected=False, visual_keying=True, clear_constraints=True, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    if rig.animation_data and rig.animation_data.action: rig.animation_data.action.name = 'stir'
    sc.frame_set(0); bpy.context.view_layer.update()
    for side, tgt in (('r', POT + Vector((0.08, 0, 0))), ('l', Vector((0.16, -0.40, 1.12)))):  # frame 0 of the circle
        hb = rig.pose.bones['hand_' + side]
        print('HAND', side, tuple(round(c, 3) for c in (rig.matrix_world @ hb.head)), 'target', tuple(round(c, 3) for c in tgt))
    for e in (tr, tl, pr, pl): bpy.data.objects.remove(e)
    # hang the ladle from the fist straight down into the broth, then pin it to the hand in that pose
    sc.frame_set(0); bpy.context.view_layer.update()
    hb = rig.pose.bones['hand_r']
    palm = rig.matrix_world @ (hb.head.lerp(hb.tail, 0.75))
    down = Matrix.Translation(palm + Vector((0, 0, 0.01))) @ Matrix.Rotation(math.radians(12), 4, 'Y')
    ladle = bpy.data.objects['cook_ladle']
    ladle.parent = None; ladle.matrix_world = down
    ladle.parent = rig; ladle.parent_type = 'BONE'; ladle.parent_bone = 'hand_r'
    ladle.matrix_world = down
    sc.frame_start, sc.frame_end = 0, FR
    for o in sc.objects: o.select_set(o.type in ('MESH', 'ARMATURE') and o.name.startswith('cook_'))
    if os.environ.get('COOK_STILLS'):
        sc.render.resolution_x, sc.render.resolution_y = 800, 800
        for f, view, loc in ((0, 'front', (0.0, -3.2, 1.4)), (0, 'side', (-3.2, -0.2, 1.4)), (0, 'top', (0.0, -0.3, 4.2)), (24, 'front', (0.0, -3.2, 1.4))):
            sc.frame_set(f)
            cam.location = loc
            cam.rotation_euler = (Vector((-0.15, -0.2, 1.25)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = OUT + f'stir_{view}_{f:02d}.png'; bpy.ops.render.render(write_still=True)
    bpy.ops.export_scene.gltf(filepath=os.environ['COOK_GLB'], export_format='GLB', use_selection=True,
                              export_apply=True, export_rest_position_armature=True, export_animations=True,
                              export_yup=True)
    dg = bpy.context.evaluated_depsgraph_get()
    tris = sum(sum(len(p.vertices) - 2 for p in o.evaluated_get(dg).to_mesh().polygons) for o in sc.objects if o.type == 'MESH' and o.select_get())
    print('EXPORT_TRIS', tris, os.path.getsize(os.environ['COOK_GLB']))
