"""
PoB HTTP Server - Path of Building build analysis HTTP API for 爱丽丝
Simple FastAPI server exposing PoB decode/analysis tools as REST endpoints.
Port: 7892
"""
import base64
import zlib
import xml.etree.ElementTree as ET
import json
import os
import sys
import subprocess
import time
import re
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

POB_PATH = r"G:\poegj\PoeCharm3[20251103]-Release-3.5.0\PathOfBuildingCommunity-Portable"

app = FastAPI(title="PoB Analysis Server", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ─── Core helpers ───────────────────────────────────────────────────────────

def _decode_build_code(code: str) -> str:
    code = code.strip()
    code = code.replace('-', '+').replace('_', '/')
    pad = (4 - len(code) % 4) % 4
    code += '=' * pad
    raw = base64.b64decode(code)
    xml_bytes = zlib.decompress(raw)
    return xml_bytes.decode('utf-8')


def _load_xml(code: Optional[str] = None, xml_path: Optional[str] = None) -> ET.Element:
    if code:
        return ET.fromstring(_decode_build_code(code))
    if xml_path:
        return ET.parse(xml_path).getroot()
    raise ValueError("Provide 'code' or 'xml_path'")


# ─── Request models ──────────────────────────────────────────────────────────

class BuildRequest(BaseModel):
    code: Optional[str] = None
    xml_path: Optional[str] = None


class FilenameRequest(BaseModel):
    filename: str = "冬抄"


class DecodeRequest(BaseModel):
    code: str


class LoadBuildRequest(BaseModel):
    code: Optional[str] = None       # raw PoB base64 build code
    doc_path: Optional[str] = None   # path in docs service e.g. "poe/pob_list/冬潮烙印.md"
    save_as: str = "imported-build"  # ASCII filename to save in Builds folder (no .xml)
    launch_pob: bool = True          # whether to kill+restart PoB after loading


# ─── PoB process helpers ──────────────────────────────────────────────────────

POB_EXE = os.path.join(POB_PATH, "Path of Building.exe")
SETTINGS_XML = os.path.join(POB_PATH, "Settings.xml")
PWSH = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

def _kill_pob():
    """Kill all running Path of Building processes."""
    try:
        subprocess.run(
            [PWSH, "-NoProfile", "-Command",
             "Get-Process | Where-Object { $_.MainWindowTitle -like '*Path of Building*' "
             "-or $_.Name -like '*PathOfBuild*' } | ForEach-Object { Stop-Process -Id $_.Id -Force }"],
            capture_output=True, text=True, timeout=10
        )
    except Exception:
        pass
    time.sleep(1.5)  # wait for process to fully exit + save Settings.xml


def _update_settings_xml(xml_full_path: str, build_name: str):
    """Update Settings.xml to open the specified build on next launch."""
    # Use forward slashes for Lua compatibility
    fwd_path = xml_full_path.replace("\\", "/")
    template = f"""<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
\t<Mode mode="BUILD">
\t\t<Arg string="{fwd_path}"/>
\t\t<Arg string="{build_name}"/>
\t</Mode>
\t<Accounts/>
\t<SharedItems/>
\t<Misc showThousandsSeparators="true" edgeSearchHighlight="true" thousandsSeparator="," decimalSeparator="." connectionProtocol="nil" showTitlebarName="true" dpiScaleOverridePercent="0" showWarnings="true" slotOnlyTooltips="true" notSupportedModTooltips="true" disableDevAutoSave="nil" POESESSID="" showPublicBuilds="true" showFlavourText="true" showAnimations="true" showAllItemAffixes="true" colorPositive="^x33FF77" buildSortMode="NAME" defaultItemAffixQuality="0.5" nodePowerTheme="RED/BLUE" defaultGemQuality="0" defaultCharLevel="1" invertSliderScrollDirection="nil" colorNegative="^xDD0022" betaTest="nil" colorHighlight="^xFF0000"/>
</PathOfBuilding>"""
    with open(SETTINGS_XML, "w", encoding="utf-8") as f:
        f.write(template)


def _launch_pob():
    """Launch Path of Building as a detached process."""
    subprocess.Popen(
        [POB_EXE],
        cwd=POB_PATH,
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        close_fds=True
    )


def _extract_code_from_md(md_content: str) -> Optional[str]:
    """Extract PoB build code from markdown content (inside ```...``` block)."""
    match = re.search(r'```\s*\n([A-Za-z0-9+/=_-]{20,}(?:\n[A-Za-z0-9+/=_-]+)*)\s*\n```', md_content)
    if match:
        return match.group(1).replace('\n', '').strip()
    # Also try inline
    match2 = re.search(r'`([A-Za-z0-9+/=_-]{50,})`', md_content)
    if match2:
        return match2.group(1)
    return None


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"service": "PoB Analysis Server", "version": "1.0.0", "port": 7892,
            "endpoints": ["/decode", "/summary", "/skills", "/items", "/tree", "/stats",
                          "/analyze", "/builds", "/load_build", "/pob_status"]}


@app.get("/builds")
def list_builds():
    """List all build XML files in the PoB Builds folder."""
    try:
        builds_path = os.path.join(POB_PATH, "Builds")
        builds = [f.replace('.xml', '') for f in os.listdir(builds_path) if f.endswith('.xml')]
        return {"success": True, "builds": builds, "count": len(builds)}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/decode")
def decode_build(req: DecodeRequest):
    """Decode a PoB build code to XML."""
    try:
        xml_str = _decode_build_code(req.code)
        return {"success": True, "xml_length": len(xml_str), "preview": xml_str[:500], "full_xml": xml_str}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/summary")
def get_build_summary(req: BuildRequest):
    """Get build summary: class, ascendancy, level, main skill, key stats."""
    try:
        root = _load_xml(req.code, req.xml_path)
        build = root.find('Build')
        if build is None:
            return {"success": False, "error": "No Build element found"}

        summary = {
            "class": build.get('className', ''),
            "ascendancy": build.get('ascendClassName', ''),
            "level": int(build.get('level', 0)),
            "main_socket_group": int(build.get('mainSocketGroup', 1)),
            "bandit": build.get('bandit', 'None'),
            "notes": (root.findtext('Notes') or '').strip()[:200],
        }

        STAT_KEYS = {
            'TotalDPS', 'TotalDot', 'WithDotDPS', 'AverageHit', 'AverageBurstDamage',
            'Speed', 'HitChance', 'CritChance', 'CritMultiplier',
            'Life', 'EnergyShield', 'Mana', 'Armour', 'Evasion',
            'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist',
            'PhysicalDamageReduction', 'EffectiveMovementSpeed'
        }
        stats = {}
        for s in build.findall('PlayerStat'):
            name = s.get('stat', '')
            if name in STAT_KEYS:
                try:
                    stats[name] = float(s.get('value', 0))
                except ValueError:
                    stats[name] = s.get('value', '')
        summary['stats'] = stats

        # Main active skill
        skills_el = root.find('Skills')
        main_skill = None
        if skills_el is not None:
            skill_sets = skills_el.findall('SkillSet') or [skills_el]
            all_skills = [s for ss in skill_sets for s in ss.findall('Skill')]
            mg = summary['main_socket_group'] - 1
            if 0 <= mg < len(all_skills):
                skill = all_skills[mg]
                gems = [g.get('nameSpec', '') for g in skill.findall('Gem')
                        if g.get('enabled', 'true').lower() != 'false']
                main_skill = {"slot": skill.get('slot', ''), "label": skill.get('label', ''), "gems": gems}
        summary['main_skill'] = main_skill

        return {"success": True, "build": summary}
    except Exception as e:
        import traceback
        return {"success": False, "error": str(e), "trace": traceback.format_exc()[-500:]}


@app.post("/skills")
def get_skills(req: BuildRequest):
    """Get all skill socket groups with gem details."""
    try:
        root = _load_xml(req.code, req.xml_path)
        skills_el = root.find('Skills')
        if skills_el is None:
            return {"success": False, "error": "No Skills element found"}

        result = []
        for ss in (skills_el.findall('SkillSet') or [skills_el]):
            ss_title = ss.get('title', '')
            for skill in ss.findall('Skill'):
                gems = [{"name": g.get('nameSpec', ''), "level": int(g.get('level', 1)),
                         "quality": int(g.get('quality', 0)),
                         "enabled": g.get('enabled', 'true').lower() != 'false'}
                        for g in skill.findall('Gem')]
                result.append({
                    "skill_set": ss_title,
                    "slot": skill.get('slot', ''),
                    "label": skill.get('label', ''),
                    "enabled": skill.get('enabled', 'true').lower() != 'false',
                    "gems": gems
                })

        return {"success": True, "skill_count": len(result), "skills": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/items")
def get_items(req: BuildRequest):
    """Get equipped items with slot assignments."""
    try:
        root = _load_xml(req.code, req.xml_path)
        items_el = root.find('Items')
        if items_el is None:
            return {"success": False, "error": "No Items element found"}

        # Slots are <Slot name="..." itemId="..."/> elements inside <ItemSet>
        slots = {}
        for item_set in items_el.findall('ItemSet'):
            for slot in item_set.findall('Slot'):
                iid = slot.get('itemId', '0')
                if iid and iid != '0':
                    slots[slot.get('name', '')] = iid
            break  # use first/active ItemSet only

        # Fallback: try top-level <Slot> elements
        if not slots:
            slots = {s.get('name', ''): s.get('itemId', '0') for s in items_el.findall('Slot')}

        # Parse all items
        items_by_id = {}
        for item in items_el.findall('Item'):
            item_id = item.get('id', '')
            lines = [l.strip() for l in (item.text or '').strip().split('\n') if l.strip()]
            rarity, name, base, mods = 'Normal', '', '', []
            skip_next = False
            for line in lines:
                if line.startswith('Rarity:'):
                    rarity = line.split(':', 1)[1].strip().title()
                elif line.startswith('{') or line.startswith('Implicits:'):
                    continue
                elif not name:
                    name = line
                elif not base:
                    base = line
                else:
                    mods.append(line)
            items_by_id[item_id] = {"rarity": rarity, "name": name, "base": base, "mods": mods[:12]}

        equipped = [{"slot": slot, **items_by_id[iid]}
                    for slot, iid in slots.items()
                    if iid and iid != '0' and iid in items_by_id]
        equipped.sort(key=lambda x: x['slot'])

        return {"success": True, "item_count": len(equipped), "items": equipped}
    except Exception as e:
        import traceback
        return {"success": False, "error": str(e), "trace": traceback.format_exc()[-300:]}


@app.post("/tree")
def get_passive_tree(req: BuildRequest):
    """Get passive tree node allocations."""
    try:
        root = _load_xml(req.code, req.xml_path)
        tree_el = root.find('Tree')
        if tree_el is None:
            return {"success": False, "error": "No Tree element found"}

        specs = []
        for spec in tree_el.findall('Spec'):
            nodes = [n for n in spec.get('nodes', '').split(',') if n]
            specs.append({
                "title": spec.get('title', ''),
                "tree_version": spec.get('treeVersion', ''),
                "class_id": spec.get('classId', ''),
                "ascend_class_id": spec.get('ascendClassId', ''),
                "total_nodes": len(nodes),
                "node_ids": nodes,
                "mastery_effects": {m.get('node', ''): m.get('effect', '') for m in spec.findall('MasteryEffect')},
                "sockets": {s.get('nodeId', ''): s.get('itemId', '') for s in spec.findall('Socket')}
            })
        return {"success": True, "specs": specs}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/stats")
def get_all_stats(req: BuildRequest):
    """Get ALL player stats from the build."""
    try:
        root = _load_xml(req.code, req.xml_path)
        build = root.find('Build')
        if build is None:
            return {"success": False, "error": "No Build element found"}
        stats = {}
        for s in build.findall('PlayerStat'):
            name = s.get('stat', '')
            try:
                stats[name] = float(s.get('value', ''))
            except ValueError:
                stats[name] = s.get('value', '')
        return {"success": True, "stat_count": len(stats), "stats": stats}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/analyze")
def analyze_build_from_file(req: FilenameRequest):
    """Full analysis of a build from the PoB Builds folder by filename (no .xml needed)."""
    xml_path = os.path.join(POB_PATH, "Builds", f"{req.filename}.xml")
    if not os.path.exists(xml_path):
        builds = [f.replace('.xml', '') for f in os.listdir(os.path.join(POB_PATH, "Builds")) if f.endswith('.xml')]
        return {"success": False, "error": f"Build not found: {req.filename}", "available": builds}

    br = BuildRequest(xml_path=xml_path)
    summary_r = get_build_summary(br)
    skills_r = get_skills(br)
    items_r = get_items(br)
    tree_r = get_passive_tree(br)

    return {
        "success": True,
        "filename": req.filename,
        "summary": summary_r.get("build"),
        "skills": skills_r.get("skills"),
        "items": items_r.get("items"),
        "passive_tree": tree_r.get("specs")
    }


@app.get("/pob_status")
def pob_status():
    """Check if PoB is currently running and what build is loaded (from Settings.xml)."""
    try:
        result = subprocess.run(
            [PWSH, "-NoProfile", "-Command",
             "Get-Process | Where-Object { $_.MainWindowTitle -like '*Path of Building*' "
             "-or $_.ProcessName -like '*PathOfBuild*' } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json"],
            capture_output=True, text=True, timeout=10
        )
        procs = []
        if result.stdout.strip():
            try:
                procs = json.loads(result.stdout)
                if isinstance(procs, dict):
                    procs = [procs]
            except Exception:
                pass

        # Read Settings.xml to know last loaded build
        current_build = None
        if os.path.exists(SETTINGS_XML):
            try:
                tree = ET.parse(SETTINGS_XML)
                root = tree.getroot()
                mode_el = root.find('Mode')
                if mode_el is not None:
                    args = mode_el.findall('Arg')
                    if len(args) >= 2:
                        current_build = {"path": args[0].get('string', ''), "name": args[1].get('string', '')}
            except Exception:
                pass

        return {
            "success": True,
            "pob_running": len(procs) > 0,
            "processes": procs,
            "current_build": current_build
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/load_build")
def load_build(req: LoadBuildRequest):
    """
    Load a PoB build via shell (no keyboard). Steps:
    1. Get build code (from request or docs service file)
    2. Decode + save XML to Builds folder
    3. Kill PoB process
    4. Update Settings.xml
    5. Launch PoB
    """
    try:
        build_code = req.code

        # If doc_path provided, fetch from docs service
        if not build_code and req.doc_path:
            import urllib.request
            import urllib.parse
            # URL-encode the path to handle Chinese characters
            encoded_path = urllib.parse.quote(req.doc_path, safe='/')
            url = f"http://localhost:7439/api/file?path={encoded_path}"
            with urllib.request.urlopen(url, timeout=10) as resp:
                data = json.loads(resp.read())
            md_content = data.get('content', '')
            build_code = _extract_code_from_md(md_content)
            if not build_code:
                return {"success": False, "error": f"No PoB build code found in: {req.doc_path}",
                        "markdown_preview": md_content[:300]}

        if not build_code:
            return {"success": False, "error": "No build code provided. Use 'code' or 'doc_path' field."}

        # Step 1: Decode
        xml_str = _decode_build_code(build_code)
        xml_root = ET.fromstring(xml_str)
        build_el = xml_root.find('Build')
        build_info = {
            "class": build_el.get('className', '') if build_el is not None else '',
            "ascendancy": build_el.get('ascendClassName', '') if build_el is not None else '',
            "level": build_el.get('level', '?') if build_el is not None else '?',
        }

        # Step 2: Save XML to Builds folder
        safe_name = re.sub(r'[^\w\-]', '-', req.save_as)  # ASCII safe
        xml_path = os.path.join(POB_PATH, "Builds", f"{safe_name}.xml")
        with open(xml_path, "w", encoding="utf-8") as f:
            f.write(xml_str)

        steps = [f"✅ Build decoded: {build_info['class']}/{build_info['ascendancy']} Lv{build_info['level']}",
                 f"✅ Saved: {xml_path}"]

        if req.launch_pob:
            # Step 3: Kill PoB
            _kill_pob()
            steps.append("✅ PoB process stopped")

            # Step 4: Update Settings.xml
            _update_settings_xml(xml_path, safe_name)
            steps.append("✅ Settings.xml updated")

            # Step 5: Launch PoB
            _launch_pob()
            steps.append("✅ PoB launched")

        return {
            "success": True,
            "steps": steps,
            "build": build_info,
            "xml_path": xml_path,
            "build_name": safe_name,
        }
    except Exception as e:
        import traceback
        return {"success": False, "error": str(e), "trace": traceback.format_exc()[-800:]}
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7892
    print(f"Starting PoB Analysis Server on http://0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
