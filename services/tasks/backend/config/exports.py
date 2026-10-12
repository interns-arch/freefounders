"""Spreadsheet exports never carry live formulas.

Text people typed (a leave reason, a form answer, a name) that starts with = + - @ (or a tab / carriage return) is
run as a formula by Excel, LibreOffice and Google Sheets when the CSV/XLSX is opened: "CSV injection". Such a cell
is written with a leading apostrophe, which spreadsheets show as plain text. Numbers stay numbers.
"""
FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value):
    if isinstance(value, str) and value.startswith(FORMULA_START):
        return "'" + value
    return value


def safe_row(row):
    return [safe_cell(v) for v in row]
