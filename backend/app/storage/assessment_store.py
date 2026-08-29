ASSESSMENTS = {}


def create_assessment(
    assessment_id,
    data
):
    ASSESSMENTS[
        assessment_id
    ] = data


def get_assessment(
    assessment_id
):
    return ASSESSMENTS.get(
        assessment_id
    )


def update_assessment(
    assessment_id,
    data
):
    ASSESSMENTS[
        assessment_id
    ] = data