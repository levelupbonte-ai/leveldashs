-- USCIS "news releases" are almost only law-enforcement stories (arrests,
-- convictions), not what members need. The source is turned off and its
-- articles hidden; the United States shows their official websites instead
-- until a better official feed is found.
update private.news_sources set active = false where id = 'us-uscis';
update private.news_items set relevant = false where source_id = 'us-uscis';
