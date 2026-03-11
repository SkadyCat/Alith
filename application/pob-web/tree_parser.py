"""
tree_parser.py - Parse PoB tree.lua files and compute node positions.
"""
import re
import math
from typing import Dict, Tuple, Optional, List
from functools import lru_cache
from pathlib import Path

POB_TREE_DIR = Path(r"G:\poegj\PoeCharm3[20251103]-Release-3.5.0\PathOfBuildingCommunity-Portable\TreeData")

# Special 40-node orbit has non-uniform angle spacing (PoB convention, degrees → radians)
_ORBIT40_ANGLES_DEG = [
    0, 10, 20, 30, 40, 45, 50, 60, 70, 80,
    90, 100, 110, 120, 130, 135, 140, 150, 160, 170,
    180, 190, 200, 210, 220, 225, 230, 240, 250, 260,
    270, 280, 290, 300, 310, 315, 320, 330, 340, 350
]
_ORBIT40_ANGLES_RAD = [d * math.pi / 180 for d in _ORBIT40_ANGLES_DEG]


def _build_orbit_angles(skills_per_orbit: List[int]) -> List[List[float]]:
    result = []
    for count in skills_per_orbit:
        if count == 40:
            result.append(_ORBIT40_ANGLES_RAD)
        else:
            result.append([2 * math.pi * i / max(count, 1) for i in range(count)])
    return result


def _parse_constants(content: str):
    """Parse skillsPerOrbit and orbitRadii from tree.lua constants section."""
    default_spo   = [1, 6, 12, 12, 40]
    default_radii = [0, 82, 162, 335, 493]

    idx = content.find('"skillsPerOrbit"')
    if idx < 0:
        return default_spo, default_radii

    def parse_int_list(start_idx: int) -> List[int]:
        brace = content.find('{', start_idx)
        if brace < 0:
            return []
        end = content.find('}', brace)
        block = content[brace + 1:end]
        vals = []
        for tok in block.split('\n'):
            tok = tok.strip().rstrip(',')
            if tok.lstrip('-').isdigit():
                vals.append(int(tok))
        return vals

    spo   = parse_int_list(idx) or default_spo
    idx2  = content.find('"orbitRadii"', idx)
    radii = parse_int_list(idx2) if idx2 > 0 else default_radii
    return spo, radii


def _parse_groups(content: str, start: int) -> Dict[int, dict]:
    """Parse the groups section: [N]= { ["x"]=..., ["y"]=..., ["nodes"]={...} }"""
    groups = {}
    i = start
    # Find opening brace of the section
    while i < len(content) and content[i] != '{':
        i += 1
    i += 1  # skip {
    depth = 1

    while i < len(content) and depth > 0:
        # Skip whitespace
        while i < len(content) and content[i] in ' \t\n\r':
            i += 1
        if i >= len(content):
            break

        ch = content[i]
        if ch == '}':
            depth -= 1
            i += 1
            break
        if ch == ',':
            i += 1
            continue
        if ch == '[':
            # [N]= { ... }
            i += 1
            j = i
            while j < len(content) and content[j].isdigit():
                j += 1
            if j == i:  # not numeric key
                i += 1
                continue
            gid = int(content[i:j])
            i = j
            # skip ]= 
            while i < len(content) and content[i] != '{':
                i += 1
            i += 1  # enter block
            # Read block with brace tracking
            bd = 1
            bs = i
            while i < len(content) and bd > 0:
                if content[i] == '{':
                    bd += 1
                elif content[i] == '}':
                    bd -= 1
                i += 1
            block = content[bs:i - 1]

            xm = re.search(r'\["x"\]= ([\-\d\.]+)', block)
            ym = re.search(r'\["y"\]= ([\-\d\.]+)', block)
            if xm and ym:
                groups[gid] = {
                    'x': float(xm.group(1)),
                    'y': float(ym.group(1))
                }
        else:
            i += 1

    return groups


def _parse_nodes(content: str, start: int) -> Dict[str, dict]:
    """Parse the flat nodes section: ["N"]= { ["skill"]=N, ["name"]="...", ... }
    Note: keys use quoted string format ["nodeId"]= { ... }
    """
    nodes = {}
    i = start
    while i < len(content) and content[i] != '{':
        i += 1
    i += 1  # skip opening {

    while i < len(content):
        # Skip whitespace and commas
        while i < len(content) and content[i] in ' \t\n\r,':
            i += 1
        if i >= len(content):
            break
        ch = content[i]
        if ch == '}':
            break
        if ch != '[':
            i += 1
            continue

        # Parse key: either ["nodeId"] or [N] (numeric)
        i += 1  # skip [
        if i >= len(content):
            break

        node_id = None
        if content[i] == '"':
            # String key ["nodeId"]
            i += 1  # skip "
            j = i
            while j < len(content) and content[j] != '"':
                j += 1
            node_id = content[i:j]
            i = j + 1  # skip closing "
        elif content[i].isdigit():
            j = i
            while j < len(content) and content[j].isdigit():
                j += 1
            node_id = content[i:j]
            i = j
        else:
            # Unknown key format, skip to next }
            depth = 0
            while i < len(content):
                if content[i] == '{':
                    depth += 1
                elif content[i] == '}':
                    if depth == 0:
                        break
                    depth -= 1
                i += 1
            continue

        # Skip ]= {
        while i < len(content) and content[i] != '{':
            i += 1
        if i >= len(content):
            break
        i += 1  # skip {

        # Read block with brace tracking
        bd = 1
        bs = i
        while i < len(content) and bd > 0:
            if content[i] == '{':
                bd += 1
            elif content[i] == '}':
                bd -= 1
            i += 1
        block = content[bs:i - 1]

        node: dict = {'id': node_id}

        # String fields
        for key in ('name', 'ascendancyName', 'icon'):
            m = re.search(rf'\["{key}"\]= "([^"]*)"', block)
            if m:
                node[key] = m.group(1)

        # Integer fields
        for key in ('skill', 'group', 'orbit', 'orbitIndex'):
            m = re.search(rf'\["{key}"\]= (\d+)', block)
            if m:
                node[key] = int(m.group(1))

        # Boolean flags
        for key in ('isNotable', 'isKeystone', 'isMastery'):
            m = re.search(rf'\["{key}"\]= (true|false)', block)
            if m:
                node[key] = m.group(1) == 'true'

        # Stat descriptions (["stats"]= { "str1", "str2", ... })
        sm = re.search(r'\["stats"\]= \{([^}]*)\}', block)
        if sm:
            node['stats'] = re.findall(r'"([^"]+)"', sm.group(1))
        else:
            node['stats'] = []

        # Out connections (single-level braces)
        om = re.search(r'\["out"\]= \{([^}]*)\}', block)
        node['out'] = re.findall(r'"(\d+)"', om.group(1)) if om else []

        if node_id:
            nodes[node_id] = node

    return nodes


def _compute_positions(nodes: Dict[str, dict], groups: Dict[int, dict],
                        orbit_radii: List[int], orbit_angles: List[List[float]]) -> None:
    """Compute x,y for each node from group position + orbit math (in-place).
    PoB formula: x = gx + sin(angle) * r, y = gy - cos(angle) * r  (0° = top/north)
    """
    for node in nodes.values():
        gid = node.get('group', 0)
        orbit = node.get('orbit', 0)
        orbit_idx = node.get('orbitIndex', 0)

        if gid in groups and orbit is not None and orbit < len(orbit_radii):
            g = groups[gid]
            radius = orbit_radii[orbit]
            angles = orbit_angles[orbit]
            angle = angles[orbit_idx % len(angles)]
            node['angle'] = angle
            # PoB uses sin for x and -cos for y (0° = top of orbit ring)
            node['x'] = round(g['x'] + radius * math.sin(angle), 4)
            node['y'] = round(g['y'] - radius * math.cos(angle), 4)
        else:
            node['angle'] = 0.0
            node['x'] = 0.0
            node['y'] = 0.0


def _get_bounds(content: str) -> dict:
    bounds = {}
    for key in ('min_x', 'min_y', 'max_x', 'max_y'):
        m = re.search(rf'"{key}"\]= ([\-\d\.]+)', content)
        if m:
            bounds[key] = float(m.group(1))
    return bounds


# === In-memory cache ===
_cache: Dict[str, dict] = {}


def load_tree(version: str) -> Optional[dict]:
    """Load and parse tree data for a given version string (e.g. '3_25')."""
    if version in _cache:
        return _cache[version]

    tree_file = POB_TREE_DIR / version / "tree.lua"
    if not tree_file.exists():
        return None

    print(f"[tree_parser] Parsing {tree_file} ...")
    content = tree_file.read_text(encoding='utf-8', errors='ignore')

    # Find section indices
    groups_idx = content.find('\n    ["groups"]= {')
    nodes_idx = content.find('\n    ["nodes"]= {')
    if groups_idx < 0 or nodes_idx < 0:
        return None

    groups = _parse_groups(content, groups_idx + 1)
    nodes  = _parse_nodes(content, nodes_idx + 1)
    spo, radii = _parse_constants(content)
    orbit_angles = _build_orbit_angles(spo)
    _compute_positions(nodes, groups, radii, orbit_angles)
    bounds = _get_bounds(content)

    result = {
        'version': version,
        'groups': groups,
        'nodes': nodes,
        'bounds': bounds,
        'node_count': len(nodes),
    }
    _cache[version] = result
    print(f"[tree_parser] Loaded {len(nodes)} nodes, {len(groups)} groups for v{version}")
    return result


def get_all_nodes(version: str, allocated_ids: List[str]) -> dict:
    """Return ALL node data for a tree version with allocated flag set."""
    tree = load_tree(version)
    if not tree:
        return {'error': f'Tree version not found: {version}', 'nodes': {}}

    nodes = tree['nodes']
    ids_set = set(allocated_ids)
    result_nodes = {}
    groups = tree['groups']

    for nid, n in nodes.items():
        # Skip orphaned nodes with no group/orbit (special cluster/mastery effects)
        if n.get('group') is None and not n.get('out'):
            continue
        gid = n.get('group')
        g = groups.get(gid, {}) if gid else {}
        result_nodes[nid] = {
            'id': nid,
            'name': n.get('name', ''),
            'x': n.get('x', 0),
            'y': n.get('y', 0),
            'gx': g.get('x', 0),   # orbit center x
            'gy': g.get('y', 0),   # orbit center y
            'group': gid,
            'orbit': n.get('orbit'),
            'angle': n.get('angle'),  # computed angle for arc drawing
            'isNotable': n.get('isNotable', False),
            'isKeystone': n.get('isKeystone', False),
            'isMastery': n.get('isMastery', False),
            'ascendancy': n.get('ascendancyName', ''),
            'allocated': nid in ids_set,
            'out': n.get('out', []),
            'stats': n.get('stats', []),
        }

    return {
        'version': version,
        'bounds': tree['bounds'],
        'nodes': result_nodes,
        'total': len(result_nodes),
        'allocated_count': len(ids_set),
    }


def get_nodes_for_build(version: str, node_ids: List[str]) -> dict:
    """Return node data (with x,y) for the given allocated node IDs."""
    tree = load_tree(version)
    if not tree:
        return {'error': f'Tree version not found: {version}', 'nodes': {}}

    nodes = tree['nodes']
    result_nodes = {}

    # Include allocated nodes + their connection neighbors
    ids_set = set(node_ids)
    all_ids = set(node_ids)
    for nid in node_ids:
        if nid in nodes:
            all_ids.update(nodes[nid].get('out', []))

    for nid in all_ids:
        if nid in nodes:
            n = nodes[nid]
            result_nodes[nid] = {
                'id': nid,
                'name': n.get('name', ''),
                'x': n.get('x', 0),
                'y': n.get('y', 0),
                'isNotable': n.get('isNotable', False),
                'isKeystone': n.get('isKeystone', False),
                'isMastery': n.get('isMastery', False),
                'ascendancy': n.get('ascendancyName', ''),
                'allocated': nid in ids_set,
                'out': n.get('out', []),
            }

    return {
        'version': version,
        'bounds': tree['bounds'],
        'nodes': result_nodes,
    }
