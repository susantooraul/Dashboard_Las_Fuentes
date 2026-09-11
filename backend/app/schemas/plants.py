from pydantic import BaseModel


class PlantConnection(BaseModel):
    name: str
    db: str
    role: str


class MenuItem(BaseModel):
    key: str
    label: str


class MenuGroup(BaseModel):
    group: str
    items: list[MenuItem]


class PlantSummary(BaseModel):
    id: str
    name: str
    state: str
    description: str
    connections: list[PlantConnection]


class PlantCatalogResponse(PlantSummary):
    menu: list[MenuGroup]
