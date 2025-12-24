Endpoint	Method	Description
/api/c-o-documents	POST	Upload a new C-of-O document
/api/c-o-documents/{id}	GET	Retrieve info/status of a document
/api/c-o-documents/{id}	PUT	Update document status or metadata
/api/c-o-documents	GET	List documents (with filters)

/api/c-o-documents/{id}	DELETE	Delete a document
/api/c-o-documents/{id}/verify	POST	Verify a document
/api/c-o-documents/{id}/verify	GET	Get verification status
/api/c-o-documents/{id}/verify	PUT	Update verification status
/api/c-o-documents/{id}/verify	DELETE	Delete verification record
/api/c-o-documents/{id}/verify	GET	Get verification status
/api/c-o-documents/{id}/verify	POST	Verify a document
/api/c-o-documents/{id}/verify	GET	Get verification status
/api/c-o-documents/{id}/verify	PUT	Update verification status
/api/c-o-documents/{id}/verify	DELETE	Delete verification record
/api/c-o-documents/{id}/verify	GET	Get verification status
/api/c-o-documents/{id}/verify	POST	Verify a document
/api/c-o-documents/{id}/verify	GET	Get verification status
/api/c-o-documents/{id}/verify	PUT	Update verification status


Use OCR + AI to extract key info automatically from documents.

/api/c-o-documents/{id}/verify	DELETE	Delete verification record


How your REST API could work:
Document Submission Endpoint

Accept uploads of scanned C-of-O documents (images, PDFs).

Accept metadata fields (owner name, property location, C-of-O number, etc.).

Processing

Use OCR + AI to extract key info automatically from documents.

Run any validation rules or checks you design.

Verification Status

Return results to the caller or store for manual/legal review.

Mark documents as “verified,” “pending,” or “rejected.”

API for Retrieval & Management

Allow querying documents by property ID, owner, or verification status.

Allow updates or notes from legal agents or admins.
https://las.oysglands.com/search/property-search - oyo state
https://landonline.lagosstate.gov.ng/ - lagos state -
https://landonline.lagosstate.gov.ng/search-ctc/search