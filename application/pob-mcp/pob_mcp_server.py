"""
PoB MCP Server - Path of Building build analysis tools for 爱丽丝
Exposes build decode/analysis as MCP tools via FastMCP (HTTP+SSE transport)
"""
import base64
import zlib
import xml.etree.ElementTree as ET
import json
import os
from pathlib import Path
from typing import Optional

from fastmcp import FastMCP

POB_PATH = r"G:\poegj\PoeCharm3[20251103]-Release-3.5.0\PathOfBuildingCommunity-Portable"

mcp = FastMCP(
    name="PoB MCP Server",
    instructions="Tools for decoding and analyzing Path of Building (PoB) build codes and XML files."
)


def _decode_build_code(code: str) -> str:
    """Decode a PoB build code (base64url + zlib) to XML string."""
    code = code.strip()
    # PoB uses URL-safe base64: replace - with + and _ with /
    code = code.replace('-', '+').replace('_', '/')
    # Pad to multiple of 4
    pad = (4 - len(code) % 4) % 4
    code += '=' * pad
    raw = base64.b64decode(code)
    xml_bytes = zlib.decompress(raw)
    return xml_bytes.decode('utf-8')


def _parse_build_xml(xml_str: str) -> ET.Element:
    return ET.fromstring(xml_str)


def _load_build_file(path: str) -> ET.Element:
    tree = ET.parse(path)
    return tree.getroot()


@mcp.tool()
def decode_build_code(code: str) -> dict:
    """
    Decode a Path of Building build code (the long base64 string) into raw XML.
    Returns the XML as a string, plus a preview of the first 500 chars.
    """
    try:
        xml_str = _decode_build_code(code)
        return {
            "success": True,
            "xml_length": len(xml_str),
            "preview": xml_str[:500],
            "full_xml": xml_str
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def get_build_summary(code: Optional[str] = None, xml_path: Optional[str] = None) -> dict:
    """
    Get a comprehensive summary of a PoB build.
    Provide either a build code (base64 string) or a path to an XML file.
    Returns: class, ascendancy, level, main skills, key stats (DPS, life, ES, etc.)
    """
    try:
        if code:
            xml_str = _decode_build_code(code)
            root = _parse_build_xml(xml_str)
        elif xml_path:
            root = _load_build_file(xml_path)
        else:
            return {"success": False, "error": "Provide either 'code' or 'xml_path'"}

        build = root.find('Build')
        if build is None:
            return {"success": False, "error": "No Build element found in XML"}

        # Basic info
        summary = {
            "class": build.get('className', ''),
            "ascendancy": build.get('ascendClassName', ''),
            "level": int(build.get('level', 0)),
            "main_socket_group": int(build.get('mainSocketGroup', 1)),
            "bandit": build.get('bandit', 'None'),
            "notes": root.findtext('Notes', '').strip()[:200],
        }

        # Key stats
        stat_keys = {
            'TotalDPS', 'TotalDot', 'WithDotDPS', 'AverageHit',
            'Speed', 'HitChance', 'CritChance', 'CritMultiplier',
            'Life', 'EnergyShield', 'Mana', 'Armour', 'Evasion',
            'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist',
            'PhysicalDamageReduction', 'EffectiveMovementSpeed'
        }
        stats = {}
        for stat_el in build.findall('PlayerStat'):
            name = stat_el.get('stat', '')
            if name in stat_keys:
                try:
                    stats[name] = float(stat_el.get('value', 0))
                except ValueError:
                    stats[name] = stat_el.get('value', '')
        summary['stats'] = stats

        # Main active skill (find the mainSocketGroup)
        skills_el = root.find('Skills')
        main_skill = None
        if skills_el is not None:
            skill_sets = skills_el.findall('SkillSet')
            if not skill_sets:
                skill_sets_from = skills_el
                all_skills = skills_el.findall('Skill')
            else:
                all_skills = []
                for ss in skill_sets:
                    all_skills.extend(ss.findall('Skill'))

            active_skills = [s for s in all_skills if s.get('enabled', 'true').lower() != 'false']
            # Try to find by index
            mg = summary['main_socket_group'] - 1
            if 0 <= mg < len(active_skills):
                skill = active_skills[mg]
                gems = [g.get('nameSpec', '') for g in skill.findall('Gem')
                        if g.get('enabled', 'true').lower() != 'false']
                main_skill = {
                    "slot": skill.get('slot', ''),
                    "label": skill.get('label', ''),
                    "gems": gems
                }
        summary['main_skill'] = main_skill

        return {"success": True, "build": summary}

    except Exception as e:
        import traceback
        return {"success": False, "error": str(e), "trace": traceback.format_exc()[-500:]}


@mcp.tool()
def get_skills(code: Optional[str] = None, xml_path: Optional[str] = None) -> dict:
    """
    List all skill socket groups in a PoB build.
    Provide either a build code or xml_path.
    Returns all skill slots with their gem names, levels, and quality.
    """
    try:
        if code:
            xml_str = _decode_build_code(code)
            root = _parse_build_xml(xml_str)
        elif xml_path:
            root = _load_build_file(xml_path)
        else:
            return {"success": False, "error": "Provide either 'code' or 'xml_path'"}

        skills_el = root.find('Skills')
        if skills_el is None:
            return {"success": False, "error": "No Skills element found"}

        result = []
        skill_set_els = skills_el.findall('SkillSet')
        if not skill_set_els:
            skill_set_els = [skills_el]

        for ss in skill_set_els:
            ss_title = ss.get('title', '')
            for skill in ss.findall('Skill'):
                gems = []
                for gem in skill.findall('Gem'):
                    gems.append({
                        "name": gem.get('nameSpec', ''),
                        "level": int(gem.get('level', 1)),
                        "quality": int(gem.get('quality', 0)),
                        "enabled": gem.get('enabled', 'true').lower() != 'false',
                        "skillPart": gem.get('skillPart', ''),
                        "gemId": gem.get('gemId', '')
                    })
                result.append({
                    "skill_set": ss_title,
                    "slot": skill.get('slot', ''),
                    "label": skill.get('label', ''),
                    "enabled": skill.get('enabled', 'true').lower() != 'false',
                    "active_effect": skill.get('activeEffect', ''),
                    "gems": gems
                })

        return {"success": True, "skill_count": len(result), "skills": result}

    except Exception as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def get_items(code: Optional[str] = None, xml_path: Optional[str] = None) -> dict:
    """
    Get all equipped items from a PoB build.
    Provide either a build code or xml_path.
    Returns item slots and item details (name, base, mods).
    """
    try:
        if code:
            xml_str = _decode_build_code(code)
            root = _parse_build_xml(xml_str)
        elif xml_path:
            root = _load_build_file(xml_path)
        else:
            return {"success": False, "error": "Provide either 'code' or 'xml_path'"}

        items_el = root.find('Items')
        if items_el is None:
            return {"success": False, "error": "No Items element found"}

        # Parse slot assignments
        slots = {}
        for slot in items_el.findall('Slot'):
            slot_name = slot.get('name', '')
            item_id = slot.get('itemId', '0')
            slots[slot_name] = item_id

        # Parse items
        items_by_id = {}
        for item in items_el.findall('Item'):
            item_id = item.get('id', '')
            text = item.text or ''
            lines = [l.strip() for l in text.strip().split('\n') if l.strip()]
            rarity = 'Normal'
            name = ''
            base = ''
            mods = []
            for line in lines:
                if line.startswith('Rarity:'):
                    rarity = line.split(':', 1)[1].strip()
                elif not name and not line.startswith('{'):
                    name = line
                elif name and not base and not line.startswith('{') and not line.startswith('Implicits:'):
                    base = line
                elif line.startswith('{') or line.startswith('Implicits:'):
                    pass
                else:
                    mods.append(line)
            items_by_id[item_id] = {
                "rarity": rarity,
                "name": name,
                "base": base,
                "mods": mods[:10]  # limit mods
            }

        # Map slots to items
        equipped = []
        for slot_name, item_id in slots.items():
            if item_id and item_id != '0' and item_id in items_by_id:
                equipped.append({
                    "slot": slot_name,
                    **items_by_id[item_id]
                })

        return {
            "success": True,
            "item_count": len(equipped),
            "items": equipped,
            "all_items": list(items_by_id.values())
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def get_passive_tree(code: Optional[str] = None, xml_path: Optional[str] = None) -> dict:
    """
    Get passive tree nodes from a PoB build.
    Returns list of allocated node IDs and any jewel sockets/masteries.
    """
    try:
        if code:
            xml_str = _decode_build_code(code)
            root = _parse_build_xml(xml_str)
        elif xml_path:
            root = _load_build_file(xml_path)
        else:
            return {"success": False, "error": "Provide either 'code' or 'xml_path'"}

        tree_el = root.find('Tree')
        if tree_el is None:
            return {"success": False, "error": "No Tree element found"}

        specs = []
        for spec in tree_el.findall('Spec'):
            nodes_str = spec.get('nodes', '')
            node_ids = [n for n in nodes_str.split(',') if n]
            mastery_effects = {}
            for me in spec.findall('MasteryEffect'):
                mastery_effects[me.get('node', '')] = me.get('effect', '')

            sockets = {}
            for sock in spec.findall('Socket'):
                sockets[sock.get('nodeId', '')] = sock.get('itemId', '')

            specs.append({
                "title": spec.get('title', ''),
                "tree_version": spec.get('treeVersion', ''),
                "class_id": spec.get('classId', ''),
                "ascend_class_id": spec.get('ascendClassId', ''),
                "node_count": len(node_ids),
                "node_ids": node_ids[:50],  # first 50
                "total_nodes": len(node_ids),
                "mastery_effects": mastery_effects,
                "sockets": sockets
            })

        return {"success": True, "specs": specs}

    except Exception as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def get_all_stats(code: Optional[str] = None, xml_path: Optional[str] = None) -> dict:
    """
    Get ALL player stats from a PoB build (not just the key ones).
    Returns a dict of stat_name -> value for every stat in the build.
    """
    try:
        if code:
            xml_str = _decode_build_code(code)
            root = _parse_build_xml(xml_str)
        elif xml_path:
            root = _load_build_file(xml_path)
        else:
            return {"success": False, "error": "Provide either 'code' or 'xml_path'"}

        build = root.find('Build')
        if build is None:
            return {"success": False, "error": "No Build element found"}

        stats = {}
        for stat_el in build.findall('PlayerStat'):
            name = stat_el.get('stat', '')
            val = stat_el.get('value', '')
            try:
                stats[name] = float(val)
            except ValueError:
                stats[name] = val

        return {"success": True, "stat_count": len(stats), "stats": stats}

    except Exception as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def analyze_build_from_file(filename: str = "冬抄") -> dict:
    """
    Analyze a build directly from the PoB Builds folder by filename (without .xml extension).
    Default is '冬抄'. Returns full build summary including skills, stats, and items.
    """
    xml_path = os.path.join(POB_PATH, "Builds", f"{filename}.xml")
    if not os.path.exists(xml_path):
        builds = [f.replace('.xml', '') for f in os.listdir(os.path.join(POB_PATH, "Builds"))
                  if f.endswith('.xml')]
        return {"success": False, "error": f"File not found: {xml_path}", "available_builds": builds}

    summary = get_build_summary(xml_path=xml_path)
    skills = get_skills(xml_path=xml_path)
    items = get_items(xml_path=xml_path)
    tree = get_passive_tree(xml_path=xml_path)

    return {
        "success": True,
        "filename": filename,
        "summary": summary.get("build"),
        "skills": skills.get("skills"),
        "items": items.get("items"),
        "passive_tree": tree.get("specs")
    }


@mcp.tool()
def list_builds() -> dict:
    """List all available build files in the PoB Builds folder."""
    builds_path = os.path.join(POB_PATH, "Builds")
    try:
        builds = [f.replace('.xml', '') for f in os.listdir(builds_path) if f.endswith('.xml')]
        return {"success": True, "builds": builds, "count": len(builds)}
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7892
    print(f"Starting PoB MCP Server on port {port}...")
    mcp.run(transport="http", port=port, host="0.0.0.0")
