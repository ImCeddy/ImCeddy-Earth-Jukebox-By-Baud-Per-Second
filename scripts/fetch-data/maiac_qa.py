from __future__ import annotations

import numpy as np


def aod_quality_masks(aod: np.ndarray, qa: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if aod.shape != qa.shape:
        raise ValueError("AOD and QA arrays must have matching shapes.")

    cloud_mask = qa & 0b111
    land_water_snow = (qa >> 3) & 0b11
    adjacency = (qa >> 5) & 0b111
    retrieval_quality = (qa >> 8) & 0b1111
    usable_retrieval = (
        (cloud_mask == 1)
        & (land_water_snow == 0)
        & (retrieval_quality == 0)
        & np.isfinite(aod)
        & (aod >= -1000)
        & (aod < 5000)
    )
    good = usable_retrieval & (adjacency == 0)
    marginal = usable_retrieval & (adjacency == 3)
    return good, marginal
