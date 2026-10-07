from rest_framework.pagination import PageNumberPagination


class DefaultPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 300

    def get_paginated_response(self, data):
        """Carry back the dates a range filter actually resolved to.

        A view sets `request.applied_range` and it rides out with the page, so
        the screen can show "01 - 30 Sept" instead of leaving people to work
        out where a week ends -- the same confusion the dashboard already fixed.
        """
        res = super().get_paginated_response(data)
        applied = getattr(self.request, "applied_range", None)
        if applied:
            res.data["range_from"], res.data["range_to"] = applied
        return res
