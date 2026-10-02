"""One-time cleanup of the original local starter workspace.

Only known starter paths are touched. Original TextPacks are copied to the
hidden archive before a move or template update; occupied targets abort.
"""

import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile


def rewrite_pack(path: Path, template: dict, *, clear_body: bool = False, relative_path: str | None = None) -> None:
    with ZipFile(path) as source:
        entries = [(info, source.read(info.filename)) for info in source.infolist()]
    temporary = tempfile.NamedTemporaryFile(dir=path.parent, prefix=".refine-", delete=False)
    temporary.close()
    try:
        with ZipFile(temporary.name, "w") as target:
            for info, data in entries:
                if info.filename.endswith("/template.json"):
                    data = json.dumps(template, ensure_ascii=False, indent=2).encode()
                elif info.filename.endswith("/document.json"):
                    document = json.loads(data)
                    document["presentation"]["template"] = {"id": template["id"], "version": template["version"]}
                    if clear_body:
                        document["content"]["body"] = ""
                        document["content"]["fields"].pop("area", None)
                    data = json.dumps(document, ensure_ascii=False, indent=2).encode()
                elif info.filename.endswith("/text.md") and (clear_body or relative_path):
                    markdown = data.decode()
                    if relative_path:
                        markdown = re.sub(r'^slug: .*$', f'slug: {json.dumps(relative_path, ensure_ascii=False)}', markdown, count=1, flags=re.MULTILINE)
                    if clear_body:
                        prefix, separator, _body = markdown.partition("\n---\n")
                        if not separator:
                            raise ValueError(f"Unexpected Markdown in {path}")
                        markdown = prefix + separator
                    data = markdown.encode()
                target.writestr(info, data)
        os.replace(temporary.name, path)
    finally:
        if os.path.exists(temporary.name):
            os.unlink(temporary.name)


def main(root: Path) -> None:
    if not (root / ".texttext/starter-v1.json").is_file():
        raise ValueError("This is not an original TextText starter workspace")
    repository = Path(__file__).resolve().parents[1]
    catalog = {}
    for slug in ("article", "bookmark", "gallery", "note", "talk", "todo"):
        with ZipFile(repository / "presets/builtin" / f"{slug}.textpack") as source:
            catalog[slug] = json.loads(source.read(f"{slug}.textbundle/template.json"))
    moves = {
        "Writing/How we decide what to build.textpack": ("Blog/How we decide what to build.textpack", "article"),
        "Writing/Rebuilding a studio around live service.textpack": ("Blog/Rebuilding a studio around live service.textpack", "article"),
        "Reading/The case for slow publishing.textpack": ("Blog/The case for slow publishing.textpack", "article"),
        "Reading/How Figma multiplayer works.textpack": ("Bookmarks/How Figma multiplayer works.textpack", "bookmark"),
        "Reading/How Figma’s multiplayer technology works.textpack": ("Bookmarks/How Figma’s multiplayer technology works.textpack", "bookmark"),
    }
    updates = {
        "Tasks/Launch week.textpack": ("todo", True),
        "Gallery/Nights and weather.textpack": ("gallery", False),
        "Presentations/Writing for people who will never meet you.textpack": ("talk", False),
    }
    template_updates = {
        "Templates/Article.textpack": ("Templates/Blog post.textpack", "article"),
        "Templates/To-do.textpack": ("Templates/Task list.textpack", "todo"),
        "Templates/Talk.textpack": ("Templates/Presentation.textpack", "talk"),
        "Templates/Gallery.textpack": ("Templates/Gallery.textpack", "gallery"),
    }
    retire = [
        "Reading/Folder view.textpack", "Gallery/Folder view.textpack",
        "Journal/Timeline.textpack", "Projects/Agentic writing launch brief.textpack",
        "Projects/Website relaunch.textpack", "Templates/Case study.textpack",
        "Templates/Living brief.textpack", "Templates/Page.textpack",
        "Templates/Project.textpack", "Templates/Timeline.textpack",
    ]
    originals = [*moves, *updates, *template_updates, *retire]
    targets = [destination for destination, _ in moves.values()] + [destination for destination, _ in template_updates.values() if destination not in template_updates]
    for target in targets:
        if (root / target).exists():
            raise FileExistsError(f"Destination already exists: {target}")
    existing = [path for path in originals if (root / path).is_file()]
    if not existing:
        print("No original starter files remain to refine.")
        return
    archive = root / ".texttext/starter-before-refinement-2026-10-02"
    if archive.exists():
        raise FileExistsError(f"Archive already exists: {archive}")
    for relative in existing:
        source = root / relative
        destination = archive / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    for old, (new, slug) in moves.items():
        source = root / old
        if not source.exists():
            continue
        destination = root / new
        destination.parent.mkdir(exist_ok=True)
        source.rename(destination)
        rewrite_pack(destination, catalog[slug], relative_path=new)
    for relative, (slug, clear_body) in updates.items():
        if (root / relative).is_file():
            rewrite_pack(root / relative, catalog[slug], clear_body=clear_body)
    for old, (new, slug) in template_updates.items():
        source = root / old
        if not source.is_file():
            continue
        destination = root / new
        if destination != source:
            source.rename(destination)
        rewrite_pack(destination, catalog[slug], clear_body=slug == "todo")
    for relative in retire:
        (root / relative).unlink(missing_ok=True)
    for folder in ("Reading", "Writing", "Journal", "Projects", "Recovered", "Feeds"):
        path = root / folder
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    print(f"Refined {len(existing)} starter files. Originals: {archive}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: refine-local-starter.py WORKSPACE_ROOT")
    main(Path(sys.argv[1]).resolve())
