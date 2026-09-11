from __future__ import annotations

PLANTS = {
    "gdl-demo": {
        "id": "gdl-demo",
        "name": "ARCA CONTINENTAL",
        "state": "Jalisco",
        "description": "Monitoreo industrial para una sola planta.",
        "connections": [
            {"name": "ION_Principal", "db": "ION_Network_250321", "role": "principal"},
            {"name": "ION_Secundaria", "db": "ION_Network_250322", "role": "respaldo"},
        ],
        "menu": [
            {"group": "Transformadores", "items": [
                {"key": "transformador1", "label": "Transformador 1"},
                {"key": "transformador2", "label": "Transformador 2"},
                {"key": "transformador3", "label": "Transformador 3"},
                {"key": "transformador4", "label": "Transformador 4"},
                {"key": "transformador5", "label": "Transformador 5"},
            ]},
            {"group": "Principal", "items": [
                {"key": "dashboard", "label": "Dashboard General"},
                {"key": "multi-plant-dashboard", "label": "Dashboard Multi-planta"},
                {"key": "subestacion", "label": "Subestación Principal"},
                {"key": "alertas", "label": "Alertas"},
                            ]},
            {"group": "Agrupaciones", "items": [
                {"key": "linea1", "label": "Línea 1"},
                {"key": "linea2", "label": "Línea 2"},
                {"key": "linea3", "label": "Línea 3"},
                {"key": "pozos", "label": "Pozos"},
                {"key": "refrigeracion", "label": "Refrigeración"},
                {"key": "jarabes", "label": "Sala de Jarabes"},
                {"key": "tag", "label": "TAG"},
                {"key": "ptar", "label": "PTAR"},
                {"key": "auxiliares", "label": "Equipos Auxiliares"},
                {"key": "alumbrado", "label": "Alumbrado"},
                {"key": "transporte", "label": "Transporte"},
            ]},
        ],
    }
}

DEFAULT_PLANT_ID = "gdl-demo"


def get_plant(plant_id: str):
    return PLANTS.get(plant_id, PLANTS[DEFAULT_PLANT_ID])


def get_allowed_sections(plant_id: str) -> set[str]:
    plant = get_plant(plant_id)
    sections: set[str] = set()
    for group in plant["menu"]:
        sections.update(item["key"] for item in group["items"])
    return sections
