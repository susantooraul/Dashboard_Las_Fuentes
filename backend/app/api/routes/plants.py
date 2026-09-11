from fastapi import APIRouter

from app.demo.catalog import PLANTS, get_plant
from app.schemas.plants import PlantCatalogResponse, PlantSummary

router = APIRouter(prefix='/plants', tags=['plants'])


@router.get('', response_model=list[PlantSummary])
def list_plants():
    return [
        {
            'id': plant['id'],
            'name': plant['name'],
            'state': plant['state'],
            'description': plant['description'],
            'connections': plant['connections'],
        }
        for plant in PLANTS.values()
    ]


@router.get('/{plant_id}', response_model=PlantCatalogResponse)
def get_plant_catalog(plant_id: str):
    return get_plant(plant_id)
