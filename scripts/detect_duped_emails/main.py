# load data.csv, which contains two colummns, identifier and email
# print out all emails that show up more than once

import csv

emails = []
with open('data.csv') as csvfile:
    reader = csv.reader(csvfile)
    for row in reader:
        emails.append(row[1])
print(f"found {len(emails)} emails. example: {emails[4]}")

duplicates = [item for item in set(emails) if emails.count(item) > 1]
for dupe in duplicates:
    print(dupe)
print(f"Found {len(duplicates)} duplicates.")